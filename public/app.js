/**
 * app.js
 * Core state management and API integration for PharmaNet Pro
 */

// 1. DYNAMIC API ROUTING: Uses same domain hosting the app
const API_BASE_URL = window.location.hostname.includes('github.io') 
    ? 'https://local-pharmacy.vercel.app' 
    : window.location.origin;

let isLogin = true;
let allMeds = [];

// ============================================
// --- A. CUSTOM TOAST NOTIFICATION ENGINE ---
// ============================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    // Create toast bubble
    const toast = document.createElement('div');
    toast.className = 'p-4 rounded-2xl shadow-xl flex items-center gap-3 text-sm font-bold text-white border transition-all duration-300 translate-x-12 opacity-0 hover:translate-y-[-2px]';
    
    // Customize design based on message classification
    let iconClass = 'fa-circle-info';
    if (type === 'success') {
        toast.className += ' bg-emerald-600 border-emerald-500 shadow-emerald-600/10';
        iconClass = 'fa-circle-check';
    } else if (type === 'error') {
        toast.className += ' bg-red-600 border-red-500 shadow-red-600/10';
        iconClass = 'fa-triangle-exclamation';
    } else if (type === 'warning') {
        toast.className += ' bg-amber-500 border-amber-400 shadow-amber-500/10';
        iconClass = 'fa-bell';
    } else {
        toast.className += ' bg-indigo-600 border-indigo-500 shadow-indigo-600/10';
        iconClass = 'fa-circle-info';
    }

    toast.innerHTML = `
        <i class="fas ${iconClass} text-base shrink-0"></i>
        <div class="flex-1 leading-snug">${message}</div>
        <button class="opacity-60 hover:opacity-100 transition shrink-0"><i class="fas fa-xmark"></i></button>
    `;

    // Click close event
    toast.querySelector('button').onclick = () => {
        toast.classList.add('opacity-0', 'translate-x-12');
        setTimeout(() => toast.remove(), 300);
    };

    container.appendChild(toast);

    // Slide in
    setTimeout(() => {
        toast.classList.remove('translate-x-12', 'opacity-0');
    }, 10);

    // Auto-remove after 4.5 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.classList.add('opacity-0', 'translate-x-12');
            setTimeout(() => toast.remove(), 300);
        }
    }, 4500);
}

// Attach globally
window.showToast = showToast;


// ============================================
// --- B. AUTHENTICATION & SESSION LOGIC ---
// ============================================
function toggleAuth() {
    isLogin = !isLogin;
    const title = document.getElementById('authTitle');
    const subtitle = document.getElementById('authSubtitle');
    const toggleText = document.getElementById('toggleText');
    const registerFields = document.getElementById('registerFields');

    if (isLogin) {
        title.innerText = 'Welcome Back';
        subtitle.innerText = 'Access your personalized pharmacy panel securely.';
        toggleText.innerText = 'Need an account? Signup';
        registerFields.classList.add('hidden');
    } else {
        title.innerText = 'Create Account';
        subtitle.innerText = 'Join PharmaNet Pro and govern shelf storage easily.';
        toggleText.innerText = 'Already have an account? Login';
        registerFields.classList.remove('hidden');
    }
}

document.getElementById('authForm').onsubmit = async (e) => {
    e.preventDefault();
    
    const emailInput = document.getElementById('email');
    const passInput = document.getElementById('password');
    const nameInput = document.getElementById('regName');
    const roleInput = document.getElementById('regRole');

    // Build payload
    const body = {
        email: emailInput.value.trim(),
        password: passInput.value
    };

    if (!isLogin) {
        body.name = nameInput.value.trim();
        body.role = roleInput.value;
    }

    try {
        const endpoint = isLogin ? 'login' : 'signup';
        const res = await fetch(`${API_BASE_URL}/api/auth/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        let data;
        const textResponse = await res.text();
        try {
            data = JSON.parse(textResponse);
        } catch (parseErr) {
            console.error("Raw Server Response:", textResponse);
            showToast(`Server returned an invalid response. Raw output: ${textResponse.substring(0, 60)}...`, 'error');
            return;
        }

        if (res.ok) {
            localStorage.setItem('user', JSON.stringify(data));
            showToast(isLogin ? `Welcome back, ${data.name}!` : `Account created successfully, welcome!`, 'success');
            renderDashboard(data);
        } else {
            const errorMsg = data.error ? (data.msg ? `${data.msg}: ${data.error}` : data.error) : (data.msg || "Authentication failed. Check entry logs.");
            showToast(errorMsg, 'error');
        }
    } catch (err) {
        console.error("Auth Fetch Error:", err);
        showToast(`Network Error: Cannot connect to PharmaNet backend.`, 'error');
    }
};

function logout() {
    localStorage.removeItem('user');
    showToast("Shift completed. Session terminated.", 'info');
    setTimeout(() => {
        location.reload();
    }, 800);
}

// Attach globally
window.toggleAuth = toggleAuth;
window.logout = logout;


// ============================================
// --- C. DASHBOARD RENDER CONTROL ---
// ============================================
function renderDashboard(user) {
    // Hide auth screen and reveal layout
    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    
    const isPharmacy = user.role === 'pharmacy';
    
    // 1. Role-based view updates
    document.getElementById('pharmacyOnly').classList.toggle('hidden', !isPharmacy);
    document.getElementById('exportBtn').classList.toggle('hidden', !isPharmacy);
    document.getElementById('reportBtn').classList.toggle('hidden', !isPharmacy);
    
    // Toggle navigation buttons
    document.getElementById('navAnalytics').classList.toggle('hidden', !isPharmacy);
    document.getElementById('navHistory').classList.toggle('hidden', isPharmacy);

    // Label financial metric card (Spent vs Revenue)
    const revLabel = document.getElementById('revenueMetricLabel');
    if (revLabel) {
        revLabel.innerText = isPharmacy ? "Pharmacy Revenue" : "Total Personal Spent";
    }

    // Set Greeting
    const greet = document.getElementById('dashGreeting');
    if (greet) {
        greet.innerText = `Welcome back, ${isPharmacy ? 'Dr.' : ''} ${user.name}`;
    }

    // Fill profile card details
    document.getElementById('profName').innerText = user.name;
    document.getElementById('profEmail').innerText = user.email;
    document.getElementById('profRole').innerText = isPharmacy ? 'Pharmacy Owner / Pharmacist' : 'Customer Account';

    // Start loading inventory
    loadMeds();
    
    // Switch to first default view
    showSection('inventory');
}


// ============================================
// --- D. MEDICINE SHELF CRUD INTEGRATION ---
// ============================================

// 1. Fetch medicines from API and cache globally
async function loadMeds() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/medicines`);
        if (!res.ok) throw new Error("Fetch failed");
        
        allMeds = await res.json();
        window.allMeds = allMeds; // global bind for report sheets

        // Update cards and calculation grids
        displayMeds(allMeds);
        updateStats(allMeds);
        updateFinancialStats();

        // Refresh analytics graphs dynamically if the section is opened
        const analyticsSec = document.getElementById('analyticsSection');
        if (analyticsSec && !analyticsSec.classList.contains('hidden')) {
            initAnalytics();
        }
    } catch (err) {
        console.error("Load Inventory Error:", err);
        showToast("Error retrieving medicine inventory.", 'error');
    }
}

// 2. Render medicine items inside UI card grids
function displayMeds(medsToDisplay) {
    const list = document.getElementById('medList');
    if (!list) return;

    const user = JSON.parse(localStorage.getItem('user')) || { role: 'customer' };
    const isPharmacy = user.role === 'pharmacy';

    if (medsToDisplay.length === 0) {
        list.className = "col-span-full py-16 text-center text-slate-400 font-medium";
        list.innerHTML = `
            <div class="max-w-xs mx-auto">
                <i class="fas fa-box-open text-4xl mb-3 text-slate-300 dark:text-slate-700"></i>
                <p class="text-sm">No items found matching the current search parameters.</p>
            </div>
        `;
        return;
    }

    list.className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6";
    list.innerHTML = medsToDisplay.map(m => {
        const isOutOfStock = m.stock <= 0;
        
        // Setup visual warning indicator borders
        let cardAlertStyle = 'border-slate-200/50 dark:border-slate-800/80';
        if (m.risk === 'expired') {
            cardAlertStyle = 'border-red-500 dark:border-red-500 danger-pulse';
        } else if (m.risk === 'expiring' || m.stock < 10) {
            cardAlertStyle = 'border-amber-400 dark:border-amber-400';
        }

        // Percentage fill calculations for stock gauge progress bar (capped at 100 max)
        const progressPercentage = Math.min((m.stock / 150) * 100, 100);
        let progressColor = 'bg-indigo-600';
        if (isOutOfStock) progressColor = 'bg-red-600';
        else if (m.stock < 10) progressColor = 'bg-amber-500';
        else progressColor = 'bg-emerald-500';

        // Expiry alert notification label text
        let expiryLabel = `<p class="text-[10px] font-bold text-slate-400 uppercase">Expiry: ${m.expiryDate}</p>`;
        if (m.risk === 'expired') {
            expiryLabel = `<p class="text-[10px] font-black text-red-500 uppercase flex items-center gap-1"><i class="fas fa-skull"></i> EXPIRED</p>`;
        } else if (m.risk === 'expiring') {
            expiryLabel = `<p class="text-[10px] font-black text-amber-500 uppercase flex items-center gap-1"><i class="fas fa-clock"></i> Expiring in ${m.daysLeft} days</p>`;
        }

        return `
            <div class="glass-card rounded-[2.5rem] p-6 flex flex-col justify-between h-[340px] relative transition-all border ${cardAlertStyle}">
                
                <!-- Action Controls: Delete (Pharmacy Only) -->
                ${isPharmacy ? `
                    <button onclick="deleteMed('${m._id}')" class="absolute top-6 right-6 text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400 transition" title="Delete product">
                        <i class="fas fa-trash-alt text-sm"></i>
                    </button>
                ` : ''}

                <!-- Card Content Body -->
                <div class="space-y-4">
                    <div class="flex items-center gap-2">
                        <span class="text-[9px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full border border-indigo-500/10">
                            ${m.category}
                        </span>
                        ${m.needsAlert ? '<span class="flex h-2.5 w-2.5 rounded-full bg-red-500 shadow-lg shadow-red-500 animate-ping"></span>' : ''}
                    </div>
                    
                    <div>
                        <h3 class="text-lg font-black text-slate-800 dark:text-white mb-1 line-clamp-1 leading-tight" title="${m.name}">${m.name}</h3>
                        ${expiryLabel}
                    </div>

                    <!-- Stock level bar gauge -->
                    <div class="pt-2">
                        <div class="flex justify-between items-center mb-1.5 text-[10px] font-bold">
                            <span class="text-slate-400 uppercase">Available Quantity</span>
                            <span class="${isOutOfStock ? 'text-red-500' : 'text-emerald-500'} uppercase">
                                ${isOutOfStock ? 'Depleted' : `${m.stock} Units`}
                            </span>
                        </div>
                        <div class="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                            <div class="h-full ${progressColor} transition-all duration-500" style="width: ${progressPercentage}%"></div>
                        </div>
                    </div>
                </div>

                <!-- Footer Checkout & Management Buttons -->
                <div class="pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                    <div>
                        <span class="text-xs text-slate-400 block font-bold leading-none">PRICE</span>
                        <span class="text-2xl font-black text-slate-900 dark:text-white">$${m.price.toFixed(2)}</span>
                    </div>
                    
                    ${isPharmacy ? 
                        `<button onclick="restockMed('${m._id}')" class="bg-slate-900 dark:bg-slate-800 hover:bg-indigo-600 dark:hover:bg-indigo-600 text-white px-5 py-3 rounded-2xl text-[9px] font-black uppercase tracking-wider transition shadow-sm active:scale-95">Restock (+10)</button>` : 
                        `<button onclick="orderMed('${m._id}')" 
                            ${isOutOfStock ? 'disabled' : ''} 
                            class="bg-indigo-600 hover:bg-slate-950 text-white px-5 py-3 rounded-2xl text-[9px] font-black uppercase tracking-wider transition disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 disabled:cursor-not-allowed shadow-md shadow-indigo-600/10 active:scale-95">
                            ${isOutOfStock ? 'Out of Stock' : 'Order Now'}
                        </button>`
                    }
                </div>
            </div>`;
    }).join('');
}

// 3. Form submit handler: Add medicine
document.getElementById('medForm').onsubmit = async (e) => {
    e.preventDefault();

    const name = document.getElementById('mName').value.trim();
    const category = document.getElementById('mCat').value.trim();
    const price = Number(document.getElementById('mPrice').value);
    const stock = Number(document.getElementById('mStock').value);
    const expiryDate = document.getElementById('mExp').value;

    try {
        const res = await fetch(`${API_BASE_URL}/api/medicines`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, category, price, stock, expiryDate })
        });

        if (res.ok) {
            e.target.reset();
            showToast(`"${name}" committed to shelves!`, 'success');
            await loadMeds();
        } else {
            const data = await res.json();
            showToast(data.msg || "Failed to save product.", 'error');
        }
    } catch (err) {
        console.error("Save Medicine Error:", err);
        showToast("Error communicating with stock database.", 'error');
    }
};

// 4. Pharmacy: Restock Medicine
async function restockMed(id) {
    try {
        const res = await fetch(`${API_BASE_URL}/api/medicines/restock/${id}`, { 
            method: 'PATCH' 
        });
        
        if (res.ok) {
            showToast("Medicine stock replenished (+10 units).", 'success');
            await loadMeds();
        } else {
            showToast("Could not replenish item.", 'error');
        }
    } catch (err) {
        console.error("Restock error:", err);
        showToast("Database connection error.", 'error');
    }
}

// 5. Customer: Purchase Medicine
async function orderMed(id) {
    const user = JSON.parse(localStorage.getItem('user'));
    if (!user) return;

    try {
        const res = await fetch(`${API_BASE_URL}/api/medicines/order/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: user.email, name: user.name })
        });

        if (res.ok) {
            showToast("Order transaction successful!", 'success');
            await loadMeds();
        } else {
            const err = await res.json();
            showToast(err.msg || "Order failed.", 'error');
        }
    } catch (err) {
        console.error("Place Order Error:", err);
        showToast("Database transaction failed.", 'error');
    }
}

// 6. Delete Medicine from database
async function deleteMed(id) {
    if (!confirm("Are you sure you want to delete this medicine? All logs will be deleted.")) return;

    try {
        const res = await fetch(`${API_BASE_URL}/api/medicines/${id}`, { 
            method: 'DELETE' 
        });
        if (res.ok) {
            showToast("Medicine item deleted from shelf.", 'info');
            await loadMeds();
        } else {
            showToast("Could not remove medicine.", 'error');
        }
    } catch (err) {
        console.error("Delete error:", err);
        showToast("Database connection error.", 'error');
    }
}

// Bind globally for inline HTML click actions
window.restockMed = restockMed;
window.orderMed = orderMed;
window.deleteMed = deleteMed;


// ============================================
// --- E. TRANSACTION HISTORY (CUSTOMER) ---
// ============================================
async function loadOrderHistory() {
    const user = JSON.parse(localStorage.getItem('user'));
    if (!user) return;

    const tbody = document.getElementById('orderList');
    if (!tbody) return;

    try {
        const res = await fetch(`${API_BASE_URL}/api/orders/${user.email}`);
        const data = await res.json();

        if (data.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center p-8 text-slate-400">You haven't ordered any items yet.</td>
                </tr>`;
            return;
        }

        tbody.innerHTML = data.map(o => `
            <tr class="hover:bg-slate-100/30 dark:hover:bg-slate-800/20 transition-all">
                <td class="p-4 font-medium text-slate-400">${new Date(o.date).toLocaleString()}</td>
                <td class="p-4 font-bold text-slate-800 dark:text-white">${o.medicineName}</td>
                <td class="p-4 font-black text-emerald-500">$${Number(o.totalPrice || o.price || 0).toFixed(2)}</td>
                <td class="p-4 text-center">
                    <span class="text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-3 py-1 rounded-full">
                        Delivered
                    </span>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error("Order history fetch error:", err);
        showToast("Error retrieving history logs.", 'error');
    }
}

window.loadOrderHistory = loadOrderHistory;


// ============================================
// --- F. SHELF METRIC ANALYTICS (PHARMACY) ---
// ============================================
function initAnalytics() {
    console.log("Compiling Analytics Sheets...");
    const data = allMeds || [];

    const totalValEl = document.getElementById('anaTotalValue');
    const avgPriceEl = document.getElementById('anaAvgPrice');
    const healthEl = document.getElementById('anaHealth');
    const catList = document.getElementById('categoryList');

    if (data.length === 0) {
        if (totalValEl) totalValEl.innerText = "$0.00";
        if (avgPriceEl) avgPriceEl.innerText = "$0.00";
        if (healthEl) healthEl.innerText = "0%";
        if (catList) catList.innerHTML = '<p class="text-slate-400 text-sm py-4">No data logged.</p>';
        return;
    }

    try {
        // Compute metrics
        const totalValue = data.reduce((sum, m) => sum + (m.price * m.stock), 0);
        const totalUnits = data.reduce((sum, m) => sum + m.stock, 0);
        const avgPrice = totalUnits > 0 ? (totalValue / totalUnits) : 0;
        
        const inStockCount = data.filter(m => m.stock > 0).length;
        const stockHealth = Math.round((inStockCount / data.length) * 100);

        // Inject stats
        if (totalValEl) totalValEl.innerText = `$${totalValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        if (avgPriceEl) avgPriceEl.innerText = `$${avgPrice.toFixed(2)}`;
        if (healthEl) healthEl.innerText = `${stockHealth}%`;

        // Compute categories details
        const categories = {};
        data.forEach(m => {
            categories[m.category] = (categories[m.category] || 0) + Number(m.stock);
        });

        // Inject category bars
        if (catList) {
            catList.innerHTML = Object.entries(categories).map(([name, count]) => {
                const scaleMax = 500;
                const percentage = Math.min((count / scaleMax) * 100, 100);
                
                return `
                    <div class="mb-4">
                        <div class="flex justify-between text-[10px] font-black uppercase mb-1">
                            <span class="text-slate-500">${name}</span>
                            <span class="text-indigo-600 dark:text-indigo-400">${count} Units</span>
                        </div>
                        <div class="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                            <div class="bg-indigo-600 h-full transition-all duration-700" style="width: ${percentage}%"></div>
                        </div>
                    </div>`;
            }).join('');
        }
    } catch (err) {
        console.error("Compute analytics error:", err);
    }
}

// Calculate total spent or pharmacy revenue
async function updateFinancialStats() {
    const user = JSON.parse(localStorage.getItem('user'));
    if (!user) return;

    try {
        let total = 0;
        
        if (user.role === 'pharmacy') {
            // Pharmacy: Load all orders placed
            const res = await fetch(`${API_BASE_URL}/api/orders`);
            const orders = await res.json();
            if (orders && orders.length > 0) {
                total = orders.reduce((sum, o) => sum + Number(o.totalPrice || o.price || 0), 0);
            }
        } else {
            // Customer: Load personal orders spent
            const res = await fetch(`${API_BASE_URL}/api/orders/${user.email}`);
            const history = await res.json();
            if (history && history.length > 0) {
                total = history.reduce((sum, o) => sum + Number(o.totalPrice || o.price || 0), 0);
            }
        }

        const revEl = document.getElementById('statRev');
        if (revEl) {
            revEl.innerText = `$${total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        }
    } catch (err) {
        console.error("Financial computation failed:", err);
    }
}

// Small helper dashboard metrics
function updateStats(meds) {
    let lowStock = 0;
    let expired = 0;

    meds.forEach(m => {
        if (m.stock < 10) lowStock++;
        if (m.risk === 'expired') expired++;
    });

    if (document.getElementById('statTotal')) document.getElementById('statTotal').innerText = meds.length;
    if (document.getElementById('statLow')) document.getElementById('statLow').innerText = lowStock;
    if (document.getElementById('statExp')) document.getElementById('statExp').innerText = expired;
}

window.initAnalytics = initAnalytics;


// ============================================
// --- G. DIRECT SUPPORT CHANNELS (FEEDBACK) ---
// ============================================

// 1. Submit feedback message (Customer)
async function submitFeedback() {
    const user = JSON.parse(localStorage.getItem('user'));
    const input = document.getElementById('feedbackText');
    if (!user || !input) return;

    const message = input.value.trim();
    if (!message) {
        showToast("Please enter a feedback message.", "warning");
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/api/feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: user.name,
                email: user.email,
                message
            })
        });

        if (res.ok) {
            input.value = '';
            showToast("Feedback sent directly to operators!", "success");
        } else {
            showToast("Failed to dispatch query.", "error");
        }
    } catch (err) {
        console.error("Feedback submit error:", err);
        showToast("Connection error while sending.", "error");
    }
}

// 2. Load feedback messages (Pharmacy Owner Inbox)
async function loadFeedbackInbox() {
    const inbox = document.getElementById('feedbackInbox');
    if (!inbox) return;

    try {
        const res = await fetch(`${API_BASE_URL}/api/feedback`);
        const data = await res.json();

        if (data.length === 0) {
            inbox.innerHTML = '<p class="text-slate-400 text-center py-8">Your direct message inbox is completely clear.</p>';
            return;
        }

        inbox.innerHTML = data.map(f => `
            <div class="py-4 first:pt-0 last:pb-0 relative group">
                <div class="flex justify-between items-start mb-1.5">
                    <div>
                        <h5 class="text-sm font-extrabold text-slate-800 dark:text-white">${f.userName}</h5>
                        <a href="mailto:${f.userEmail}" class="text-[10px] text-indigo-500 font-bold hover:underline">${f.userEmail}</a>
                    </div>
                    <button onclick="deleteFeedback('${f._id}')" class="text-slate-300 hover:text-red-500 dark:text-slate-700 dark:hover:text-red-400 p-1.5 transition" title="Delete message">
                        <i class="fas fa-trash text-xs"></i>
                    </button>
                </div>
                <p class="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">${f.message}</p>
                <span class="text-[9px] font-bold text-slate-400 block mt-2">${new Date(f.date).toLocaleString()}</span>
            </div>
        `).join('');
    } catch (err) {
        console.error("Fetch inbox error:", err);
        showToast("Error retrieving operator inbox.", "error");
    }
}

// 3. Delete feedback message
async function deleteFeedback(id) {
    if (!confirm("Remove this query permanently from the logs?")) return;

    try {
        const res = await fetch(`${API_BASE_URL}/api/feedback/${id}`, { 
            method: 'DELETE' 
        });
        if (res.ok) {
            showToast("Feedback message deleted.", "info");
            await loadFeedbackInbox();
        } else {
            showToast("Could not remove message.", "error");
        }
    } catch (err) {
        console.error("Delete feedback error:", err);
        showToast("Connection error.", "error");
    }
}

window.submitFeedback = submitFeedback;
window.loadFeedbackInbox = loadFeedbackInbox;
window.deleteFeedback = deleteFeedback;


// ============================================
// --- H. COMPONENT & THEME INITIALIZATION ---
// ============================================

// Theme Toggling
function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    const icon = document.getElementById('themeIcon');
    
    if (icon) {
        icon.innerHTML = isDark 
            ? '<i class="fas fa-sun text-yellow-400 text-base animate-[spin_10s_linear_infinite]"></i>' 
            : '<i class="fas fa-moon text-base"></i>';
    }
    
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    showToast(`${isDark ? 'Dark Theme' : 'Light Theme'} enabled.`, 'info');
}

window.toggleTheme = toggleTheme;

// Dashboard Search Listener (filters on input)
const searchInput = document.getElementById('dbSearch');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        
        // Search by category, name, or low status
        const filtered = allMeds.filter(m => {
            if (term === 'low') {
                return m.stock < 10;
            }
            if (term === 'expired') {
                return m.risk === 'expired';
            }
            return m.name.toLowerCase().includes(term) || m.category.toLowerCase().includes(term);
        });
        
        displayMeds(filtered);
    });
}

// Window load init check
window.onload = () => {
    // 1. Recover Theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        const icon = document.getElementById('themeIcon');
        if (icon) icon.innerHTML = '<i class="fas fa-sun text-yellow-400 text-base animate-[spin_10s_linear_infinite]"></i>';
    }

    // 2. Recover Session User Profile
    const sessionUser = JSON.parse(localStorage.getItem('user'));
    if (sessionUser) {
        renderDashboard(sessionUser);
    }
};
