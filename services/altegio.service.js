import axios from 'axios'
import { CONFIG } from '../utils/config.js'

export async function fetchProduct(companyId, productId) {
  try {
    const { data } = await axios.get(
      `https://api.alteg.io/api/v1/goods/${companyId}/${productId}`,
      {
        headers: {
          'Authorization': `Bearer ${CONFIG.altegio.partnerToken}, User ${CONFIG.altegio.userToken}`,
          Accept: 'application/vnd.api.v2+json'
        }
      }
    );
    return data;
  } catch (error) {
    console.error('Помилка при отриманні товарів:', error.response?.data || error.message);
    throw error
  }
}

export async function fetchProductsPage(companyId, { page = 1, count = 200 } = {}) {
  try {
    const { data } = await axios.get(
      `https://api.alteg.io/api/v1/goods/${companyId}`,
      {
        params: { page, count },
        headers: {
          'Authorization': `Bearer ${CONFIG.altegio.partnerToken}, User ${CONFIG.altegio.userToken}`,
          Accept: 'application/vnd.api.v2+json'
        }
      }
    );
    return data;
  } catch (error) {
    console.error('Помилка при отриманні сторінки товарів:', error.response?.data || error.message);
    throw error
  }
}
