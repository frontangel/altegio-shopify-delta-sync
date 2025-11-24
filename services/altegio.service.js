import axios from 'axios'

// Допоміжне зчитування токенів: спершу шукаємо правильні ALTEGIO_*,
// але підтримуємо й попереднє написання ALTEGION_* щоб не ламати оточення.
const partnerToken = process.env.ALTEGIO_TOKEN ?? process.env.ALTEGION_TOKEN
const userToken = process.env.ALTEGIO_USER_TOKEN ?? process.env.ALTEGION_USER_TOKEN

export async function fetchProduct(companyId, productId) {
  try {
    const { data } = await axios.get(
      `https://api.alteg.io/api/v1/goods/${companyId}/${productId}`,
      {
        headers: {
          'Authorization': `Bearer ${partnerToken}, User ${userToken}`,
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
