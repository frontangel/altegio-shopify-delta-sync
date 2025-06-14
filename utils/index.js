export function useUtils() {
  const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return {
    sleep
  }
}
