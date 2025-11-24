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
