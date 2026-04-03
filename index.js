import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import artemisiiRoutes from './routes/artemisii.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from public/
app.use(express.static(join(__dirname, 'public')));

// API routes
app.use('/api/artemisii', artemisiiRoutes);

app.listen(PORT, () => {
  console.log(`Artemis II Tracker running at http://localhost:${PORT}`);
});
