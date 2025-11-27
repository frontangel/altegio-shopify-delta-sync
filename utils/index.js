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
    const date = new Date(parseInt(log.timestamp)).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', hour12: false });
    return {
      ...log,
      id: log.id.split(':').pop(),
      date
    }
  }

  // const returnHtmlLog = (log) => {
  //   const date = new Date(log.timestamp).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', hour12: false });
  //   const color = getColorStatus(log.status);
  //   const result = {
  //     date,
  //     status: `<span style="color: ${color}">${log.status} - <i>${log.reason}</i></span>`,
  //     type: log.type ? `<b>Type:</b> ${log.type}` : undefined,
  //     type_id: log.type_id ? `<b>Type id:</b> ${log.type_id}` : undefined,
  //     altegio_id: log.goodId ? `<b>Altegio id:</b> ${log.goodId}` : undefined,
  //     altegio_sku: log.altegio_sku ? `<b>Altegio sku:</b> ${log.altegio_sku}` : undefined,
  //     inventory_item_id: log.inventory_item_id ? `<b>Shopify id:</b> ${log.inventory_item_id}` : undefined,
  //     json: log.json ? `<div class="json-toggle" data-json='${JSON.stringify(JSON.parse(log.json)).replace(/'/g, '&#39;')}'></div>` : undefined,
  //   }
  //   const str = Object.values(result).filter(v => v).join(', ')
  //   return `<div><label class="json-toggle-wrapper"><input type="checkbox" class="json-checkbox" hidden>${str}</label></div>`;
  // }

  return {
    sleep,
    // returnHtmlLog,
    formatedLog
  }
}
