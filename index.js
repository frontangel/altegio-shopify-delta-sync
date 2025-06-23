import 'dotenv/config';
import express from 'express';
import { useStore } from './store/useStore.js';
import { CacheManager } from './store/cache.manager.js';
import { mutateInventoryQuantity } from './services/shopify.service.js'
import { addTask } from './services/queue.service.js';
import { waitUntilReady } from './middleware/waitReady.middleware.js';
import { basicAuthMiddleware } from './middleware/baseAuth.middleware.js';
import { skipUpdateStatus } from './steps/skip-update-status.step.js';
import { skipUndefinedRuleStep } from './steps/skip-undefined-rule.step.js';
import { useUtils } from './utils/index.js';
import { skipByTypeStep } from './steps/skip-by-type.step.js';
import { skipByStorageStep } from './steps/skip-by-storage.step.js';
import { skipByOnlyStatusStep } from './steps/skip-by-only-status.step.js';
import { convertAmountStep } from './steps/convert-amount.step.js';
import { skipByAmountStep } from './steps/skip-by-amount.step.js';
import { getAltegioSkuStep } from './steps/get-altegio-sku.step.js';
import { getInventoryItemIdStep } from './steps/get-inventory-item-id.step.js';


const { getShopifyInventoryIdsBySku, getAltegioArticleById } = useStore()
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

app.use(['/sku', '/db', '/logs'], basicAuthMiddleware, waitUntilReady);

app.get('/logs', (req, res) => {
  const { returnHtmlLog } = useUtils();
  const logs = CacheManager.getWebhookLogs()
  res.setHeader('Content-Type', 'text/html');
  res.send(logs.map(returnHtmlLog).join('\n'));
});

app.get('/db', async (req, res) => {
  return res.json({
    articles: CacheManager.altegioArticleShopifySky(),
    shopifySkuInventory: CacheManager.shopifySkuInventory()
  })
})

app.get('/sku', async (req, res) => {
  const shopifyInventoryId = await CacheManager.inventoryItemIdByAltegioSku(req.query.sku)
  return res.json({ shopifyInventoryId })
});

app.post('/webhook', waitUntilReady, async (req, res) => {
  const operationRules = {
    goods_operations_sale: { type_id: 1, type: 'Product sales' },
    goods_operations_receipt: {type_id: 3, type: 'Product arrival'},
    goods_operations_stolen: {type_id: 4, type: 'Product write-off'},
    goods_operations_move: {type_id: 0, type: 'Moving products', onlyStorageId: 2557508, onlyStatus: 'create'}
  };
  const { resource, status, company_id, data } = req.body;
  const { type_id, type, storage, amount: rawAmount, good } = data || {};

  const requestId =  crypto.randomUUID()

  const ctx = {
    _id: requestId,
    rules: operationRules,
    input: { resource, status, company_id, type_id, type, storage, rawAmount, good },
    state: {
      amount: 0,
      inventory_item_id: '',
    },
    error: false,
    done: false,
    log: {
      _id: requestId,
      status: 'new',
      goodId: good?.id,
      resource,
      type_id,
      type,
      storageId: storage?.id,
      reason: '',
      altegio_sku: '',
      inventory_item_id: ''
    },
    get rule() {
      return this.rules[resource]
    }
  }

  const pipeline = [
    skipUpdateStatus,
    skipUndefinedRuleStep,
    skipByTypeStep,
    skipByStorageStep,
    skipByOnlyStatusStep,
    convertAmountStep,
    skipByAmountStep,
    getAltegioSkuStep,
    getInventoryItemIdStep
  ];

  for (const step of pipeline) {
    try {
      await step(ctx);
      if (ctx.done || ctx.error) break;
    } catch (e) {
      ctx.error = true;
      ctx.log.status = 'error';
      ctx.log.reason = e.message || 'Unhandled exception';
      break;
    }
  }


  if (ctx.error) {
    CacheManager.logWebhook(ctx.log);
    return res.status(400).json({ error: true, message: ctx.log.reason });
  }

  if (ctx.done) {
    CacheManager.logWebhook(ctx.log);
    return res.status(200).json({ status: ctx.log.status, message: ctx.log.reason });
  }

  ctx.log.status = 'inprogress';
  ctx.log.reason = `Added to queue, delta: ${ctx.state.amount}`;
  CacheManager.logWebhook(ctx.log);

  addTask(() => mutateInventoryQuantity(ctx));
  return res.json({ status: ctx.log.status, message: ctx.log.reason });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    getShopifyInventoryIdsBySku().then(() => console.log('Cashing done.'))
  });
}

export default app
