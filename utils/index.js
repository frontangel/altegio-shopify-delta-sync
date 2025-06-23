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

  const returnHtmlLog = (log) => {
    const date = new Date(log.timestamp).toLocaleString('uk-UA', { timeZone: 'Europe/Kiev', hour12: false });
    const color = getColorStatus(log.status);
    return `<div>${date} 
        <span style="color: ${color}">${log.status}</span> - ${log.reason},&nbsp; 
        <b>Type:</b> ${log.type},&nbsp;
        <b>Type id:</b> ${log.type_id},&nbsp;
        <b>Altegio id:</b> ${log.goodId},&nbsp;
        <b>Altegio sku:</b> ${log.altegio_sku || ''},&nbsp;
        <b>Shopify id:</b> ${log.inventory_item_id || ''}
        </div>`;
  }

  return {
    sleep,
    returnHtmlLog
  }
}
