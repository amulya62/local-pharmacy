require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const Medicine = require('./models/Medicine');
const Order = require('./models/Order');
const Feedback = require('./models/Feedback');

const app = express();

// --- 1. MIDDLEWARE ---
const allowedOrigins = [
    "http://localhost:5000",
    "https://amulya62.github.io",
    "https://local-pharmacy.vercel.app"
];
if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.github.io')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ["GET", "POST", "PATCH", "DELETE"],
    credentials: true
})); 
app.use(express.json());

// Serve static frontend files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// --- 2. API ROUTES ---

// Authentication Router
app.use('/api/auth', authRoutes);

// --- MEDICINE INVENTORY API ---

// Create a new medicine (Pharmacy Owner)
app.post('/api/medicines', async (req, res) => {
    try {
        const { name, category, price, stock, expiryDate } = req.body;
        if (!name || !category || price === undefined || stock === undefined || !expiryDate) {
            return res.status(400).json({ msg: "Please enter all required fields" });
        }

        const newMed = new Medicine({
            name,
            category,
            price: Number(price),
            stock: Number(stock),
            expiryDate
        });

        await newMed.save();
        res.status(201).json(newMed);
    } catch (err) { 
        console.error("Add Medicine Error:", err);
        res.status(500).json({ msg: "Failed to add medicine", error: err.message }); 
    }
});

// Get all medicines with dynamic alert & expiry risk flags
app.get('/api/medicines', async (req, res) => {
    try {
        const meds = await Medicine.find().sort({ createdAt: -1 });
        
        const updatedMeds = meds.map(m => {
            const medObj = m.toObject();
            
            // Calculate days left to expiry
            const expDate = new Date(m.expiryDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0); // reset time for clean date comparison
            
            const diffTime = expDate - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            // Set flags used by frontend to render alerts
            medObj.needsAlert = diffDays <= 30; // Expired or expiring within 30 days
            medObj.daysLeft = diffDays;
            
            if (diffDays <= 0) {
                medObj.risk = 'expired';
            } else if (diffDays <= 30) {
                medObj.risk = 'expiring';
            } else {
                medObj.risk = 'healthy';
            }
            
            return medObj;
        });

        res.json(updatedMeds);
    } catch (err) {
        console.error("Get Medicines Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Delete a medicine (Pharmacy Owner)
app.delete('/api/medicines/:id', async (req, res) => {
    try {
        const deletedMed = await Medicine.findByIdAndDelete(req.params.id);
        if (!deletedMed) {
            return res.status(404).json({ msg: "Medicine not found" });
        }
        res.json({ msg: "Medicine deleted successfully" });
    } catch (err) {
        console.error("Delete Medicine Error:", err);
        res.status(500).json({ error: "Server error during deletion" });
    }
});

// Restock medicine (Pharmacy Owner - Increases stock by 10)
app.patch('/api/medicines/restock/:id', async (req, res) => {
    try {
        const med = await Medicine.findById(req.params.id);
        if (!med) {
            return res.status(404).json({ msg: "Medicine not found" });
        }

        med.stock += 10;
        await med.save();
        res.json(med);
    } catch (err) {
        console.error("Restock Medicine Error:", err);
        res.status(500).json({ msg: "Server Error" });
    }
});

// Order medicine (Customer - Decreases stock by 1, records order)
app.patch('/api/medicines/order/:id', async (req, res) => {
    try {
        const { email, name } = req.body; // Expect customer credentials in request body
        if (!email || !name) {
            return res.status(400).json({ msg: "Customer details required to place an order" });
        }

        const med = await Medicine.findById(req.params.id);
        if (!med) {
            return res.status(404).json({ msg: "Medicine not found" });
        }

        if (med.stock <= 0) {
            return res.status(400).json({ msg: "Medicine is out of stock" });
        }

        // Decrement stock
        med.stock -= 1;
        await med.save();

        // Create transaction history (Order model)
        const order = new Order({
            medicineName: med.name,
            quantity: 1,
            totalPrice: med.price,
            customerName: name,
            customerEmail: email.toLowerCase()
        });
        await order.save();

        res.json({ medicine: med, order });
    } catch (err) {
        console.error("Order Medicine Error:", err);
        res.status(500).json({ msg: "Server error while ordering" });
    }
});


// --- ORDER HISTORY API ---

// Create standard transaction order (backup fallback endpoint)
app.post('/api/orders', async (req, res) => {
    try {
        const { medicineName, quantity, totalPrice, customerName, customerEmail } = req.body;
        if (!medicineName || !quantity || !totalPrice || !customerName || !customerEmail) {
            return res.status(400).json({ msg: "Please enter all fields" });
        }

        const newOrder = new Order({
            medicineName,
            quantity: Number(quantity),
            totalPrice: Number(totalPrice),
            customerName,
            customerEmail: customerEmail.toLowerCase()
        });

        await newOrder.save();
        res.status(201).json(newOrder);
    } catch (err) {
        console.error("Create Order Error:", err);
        res.status(500).json({ msg: "Failed to log order record" });
    }
});

// Get all orders (Pharmacy Owner Analytics)
app.get('/api/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ date: -1 });
        res.json(orders);
    } catch (err) {
        console.error("Get Orders Error:", err);
        res.status(500).json({ message: "Error fetching orders list" });
    }
});

// Get personal order history for a specific customer
app.get('/api/orders/:email', async (req, res) => {
    try {
        const history = await Order.find({ customerEmail: req.params.email.toLowerCase() }).sort({ date: -1 });
        res.json(history);
    } catch (err) {
        console.error("Get Personal History Error:", err);
        res.status(500).json({ error: "Failed to fetch purchase history" });
    }
});


// --- DIRECT SUPPORT / FEEDBACK API ---

// Submit a new message (Customer)
app.post('/api/feedback', async (req, res) => {
    try {
        const { name, email, message } = req.body;
        if (!name || !email || !message) {
            return res.status(400).json({ msg: "All fields are required to submit feedback" });
        }

        const newFeedback = new Feedback({ 
            userName: name,
            userEmail: email.toLowerCase(), 
            message 
        });

        await newFeedback.save();
        res.status(201).json(newFeedback);
    } catch (err) { 
        console.error("Submit Feedback Error:", err);
        res.status(500).json({ error: "Failed to save message" }); 
    }
});

// Fetch all support messages (Pharmacy Owner Inbox)
app.get('/api/feedback', async (req, res) => {
    try {
        const feedbacks = await Feedback.find().sort({ date: -1 });
        res.json(feedbacks);
    } catch (err) { 
        console.error("Fetch Feedback Error:", err);
        res.status(500).json({ error: "Failed to fetch feedback messages" }); 
    }
});

// Delete feedback by ID (Pharmacy Owner)
app.delete('/api/feedback/:id', async (req, res) => {
    try {
        const deletedFeedback = await Feedback.findByIdAndDelete(req.params.id);
        if (!deletedFeedback) {
            return res.status(404).json({ msg: "Feedback not found" });
        }
        res.json({ msg: "Feedback message deleted successfully" });
    } catch (err) {
        console.error("Delete Feedback Error:", err);
        res.status(500).json({ error: "Server error during deletion" });
    }
});

// Fallback HTML page routing for SPA
app.get('/*splat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- 3. DATABASE CONNECTION & SERVER START ---
const mongoURI = process.env.MONGODB_URI || "mongodb+srv://pharma_admin:pharmaPassword123@cluster0.ow0h7bx.mongodb.net/pharma_network?appName=Cluster0";

// Connect to MongoDB asynchronously
mongoose.connect(mongoURI)
    .then(async () => {
        console.log("✅ MongoDB Connected Successfully");
        // Auto-clean any old conflicting indexes on the users collection from previous projects
        try {
            await mongoose.connection.db.collection('users').dropIndexes();
            console.log("🧹 Cleaned old database collection indexes successfully");
        } catch (e) {
            // Collection doesn't exist yet, ignore
        }
    })
    .catch(err => {
        console.error("❌ DB Connection Error:");
        console.error(err.message);
    });

// Dual-Mode Startup: Only call app.listen() if NOT running in the Vercel Serverless environment
if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🚀 Server running locally on port ${PORT}`));
}

// Export the Express app for Vercel Serverless Handler
module.exports = app;
