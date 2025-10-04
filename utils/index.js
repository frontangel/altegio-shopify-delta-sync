export function useUtils() {
  const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  const getColorStatus = (status) => {
    switch (status) {
      case 'success': return 'green';
      case 'skipped': return 'grey';
      case 'error': return 'red';
      default: return 'black';
    }
  }
  const formatedLog = (log) => {
    const date = new Date(log.timestamp).toLocaleString('uk-UA', { timeZone: 'Europe/Kiev', hour12: false });
    return {
      ...log,
      date
    }
  }
  const returnHtmlLog = (log) => {
    const date = new Date(log.timestamp).toLocaleString('uk-UA', { timeZone: 'Europe/Kiev', hour12: false });
    const color = getColorStatus(log.status);
    console.log(log)
    const result = {
      date,
      status: `<span style="color: ${color}">${log.status} - <i>${log.reason}</i></span>`,
      type: log.type ? `<b>Type:</b> ${log.type}` : undefined,
      type_id: log.type_id ? `<b>Type id:</b> ${log.type_id}` : undefined,
      altegio_id: log.goodId ? `<b>Altegio id:</b> ${log.goodId}` : undefined,
      altegio_sku: log.altegio_sku ? `<b>Altegio sku:</b> ${log.altegio_sku}` : undefined,
      inventory_item_id: log.inventory_item_id ? `<b>Shopify id:</b> ${log.inventory_item_id}` : undefined,
      json: log.json ? `<div class="json-toggle">${JSON.stringify(JSON.parse(log.json), null, 2)}</div>` : undefined,
    }
    const str = Object.values(result).filter(v => v).join(', ')
    return `<div><label class="json-toggle-wrapper"><input type="checkbox" class="json-checkbox" hidden>${str}</label></div>`;
  }

  return {
    sleep,
    returnHtmlLog,
    formatedLog
  }
}
