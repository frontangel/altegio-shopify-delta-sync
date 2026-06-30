import axios from 'axios'

// Допоміжне зчитування токенів: спершу шукаємо правильні ALTEGIO_*,
// але підтримуємо й попереднє написання ALTEGION_* щоб не ламати оточення.
const partnerToken = process.env.ALTEGIO_TOKEN ?? process.env.ALTEGION_TOKEN
const userToken = process.env.ALTEGIO_USER_TOKEN ?? process.env.ALTEGION_USER_TOKEN

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
    shouldRetry = (error) => {
      // Retry on network errors and 5xx server errors
      if (!error.response) return true; // Network error
      const status = error.response.status;
      return status >= 500 && status < 600;
    }
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on 4xx errors (except 429 rate limit)
      if (error.response?.status === 404) {
        throw error; // Product not found - don't retry
      }

      if (error.response?.status >= 400 && error.response?.status < 500 && error.response?.status !== 429) {
        throw error; // Client error - don't retry
      }

      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }

      const jitter = Math.random() * 200;
      const waitTime = Math.min(delay + jitter, maxDelay);

      console.warn(`[Altegio] Retry attempt ${attempt + 1}/${maxRetries} after ${Math.round(waitTime)}ms. Error: ${error.message}`);
      await sleep(waitTime);

      delay *= backoffMultiplier;
    }
  }

  throw lastError;
}

export async function fetchProduct(companyId, productId) {
  return retryWithBackoff(async () => {
    try {
      const { data } = await axios.get(
        `https://api.alteg.io/api/v1/goods/${companyId}/${productId}`,
        {
          headers: {
            'Authorization': `Bearer ${partnerToken}, User ${userToken}`,
            Accept: 'application/vnd.api.v2+json'
          },
          timeout: 10000 // 10 second timeout
        }
      );
      return data;
    } catch (error) {
      console.error('[Altegio] Error fetching product:', {
        companyId,
        productId,
        status: error.response?.status,
        message: error.message,
        data: error.response?.data
      });
      throw error;
    }
  }, {
    maxRetries: 3,
    initialDelay: 1000
  });
}
