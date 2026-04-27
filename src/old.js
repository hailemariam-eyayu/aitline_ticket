require('dotenv').config();
import express from 'express';
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const xml2js = require('xml2js');
const jwt = require('jsonwebtoken');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Example route: Fetch JSON from external API
app.get('/api/external/json', async (req, res) => {
  try {
    const response = await axios.get('https://jsonplaceholder.typicode.com/posts/1');
    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Example route: Fetch XML from external API and parse it
app.get('/api/external/xml', async (req, res) => {
  try {
    // Using a public XML API (example: weather API or similar)
    // For demo, using a mock XML response
    const xmlData = `<?xml version="1.0" encoding="UTF-8"?>
    <response>
      <status>success</status>
      <data>
        <item id="1">
          <title>Sample Item</title>
          <description>This is a sample XML item</description>
        </item>
      </data>
    </response>`;

    xml2js.parseString(xmlData, (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({
        success: true,
        data: result
      });
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Example route with authentication (JWT)
app.post('/api/login', (req, res) => {
  // Mock login - in real app, verify credentials
  const { username, password } = req.body;
  if (username === 'admin' && password === 'password') {
    const token = jwt.sign({ userId: 1, username }, process.env.JWT_SECRET || 'secret');
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// Route to process mobile number and fetch beneficiary details
app.post('/api/beneficiary/verify', async (req, res) => {
  const { mobileNumber } = req.body;

  if (!mobileNumber) {
    return res.status(400).json({ success: false, message: 'Mobile number is required' });
  }

  try {
    // Format the number by adding 251 prefix
    const formattedNumber = `251${mobileNumber}`;

    // Send request to external organization API
    const response = await axios.post('https://api.external-org.com/v1/verify-beneficiary', {
      phone: formattedNumber
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.ORG_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    // Extract full name and status from the external response
    const { fullName, status } = response.data;

    res.json({
      success: true,
      data: {
        fullName,
        status
      }
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      success: false,
      message: 'Failed to fetch beneficiary details',
      error: error.message
    });
  }
});

// Protected route
app.get('/api/protected', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    res.json({ success: true, user: decoded });
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
});

app.get('/', (req, res) => {
  res.send('Hello, World!');
});

