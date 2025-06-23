import { useStore } from '../store/useStore.js';

const { getAltegioArticleById } = useStore()
export async function getAltegioSkuStep(ctx) {
  const { company_id, good } = ctx.input
  try {
    ctx.state.altegio_sku = await getAltegioArticleById(company_id, good.id)
    ctx.log.altegio_sku = ctx.state.altegio_sku
  } catch (err) {
    ctx.error = true
    ctx.log.status = 'error'
    ctx.log.reason = err.response?.data?.meta?.message || String(err)
  }
}
