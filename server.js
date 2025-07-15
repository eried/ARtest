const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// Serve static files from the current directory
app.use(express.static('.'));

// Handle all routes by serving index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
    console.log(`AR App server running at http://localhost:${port}`);
    console.log('Make sure to access this from a mobile device for best experience');
    console.log('For HTTPS (required for some devices), use ngrok or similar service');
});
