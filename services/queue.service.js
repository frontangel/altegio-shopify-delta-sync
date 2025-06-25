// queue.service.js

const taskQueue = [];
let isProcessing = false;

// Додаємо завдання в чергу
export function addTask(taskFn) {
  taskQueue.push(taskFn);
}

// Функція, яка виконує одну задачу
export async function processNextTask() {
  if (isProcessing || taskQueue.length === 0) return;

  isProcessing = true;
  const task = taskQueue.shift();

  try {
    await task();
    console.log('✅ Task completed');
  } catch (err) {
    console.error('❌ Task failed:', err.message);
  } finally {
    isProcessing = false;
  }
}

// Запускаємо інтервал
setInterval(processNextTask, 1000); // 1 завдання/сек
