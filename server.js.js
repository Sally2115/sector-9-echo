const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Раздаем статические файлы (наш фронтенд из папки public)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Тестовый эндпоинт для сохранения/проверки
app.get('/api/ping', (req, res) => {
    res.json({ status: 'SECTOR-9 ONLINE', time: new Date() });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});