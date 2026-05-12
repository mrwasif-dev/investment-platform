// ============================================================
// PROFIT 24 - FIXED FRONTEND - ALL BUTTONS WORKING
// ============================================================

var API_URL = '';
var authToken = localStorage.getItem('p24_token') || null;
var selectedPlan = null;
var selectedPayment = null;
var accountData = null;

// Utility
function $(id) { 
    return document.getElementById(id); 
}

function showToast(msg, type) {
    type = type || 'i';
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast ' + type;
    t.style.display = 'block';
    setTimeout(function() { 
        t.style.display = 'none'; 
    }, 4000);
}

function fmt(n) { 
    return (Number(n) || 0).toLocaleString('en-US'); 
}

function hideAllPages() {
    var pages = ['authSection','dashSection','plansSection','paymentSection','depositSection','withdrawSection','transferSection','historySection','profileSection','leaderboardSection','faqSection'];
    for (var i = 0; i < pages.length; i++) { 
        var el = $(pages[i]); 
        if (el) {
            el.style.display = 'none';
        }
    }
}

function showPage(id) {
    var el = $(id);
    if (el) {
        el.style.display = 'block';
    }
}

function goToDashboard() { 
    hideAllPages(); 
    showPage('dashSection'); 
    loadDashboardData(); 
}

function goToPlans() { 
    hideAllPages(); 
    showPage('plansSection'); 
    loadPlansList(); 
}

function goToPayment() { 
    hideAllPages(); 
    showPage('paymentSection'); 
    showPaymentPage(); 
}

// ============================================================
// AUTH FUNCTIONS - FIXED
// ============================================================

function showSignupForm() { 
    document.getElementById('loginCard').style.display = 'none';
    document.getElementById('signupCard').style.display = 'block';
}

function showLoginForm() { 
    document.getElementById('signupCard').style.display = 'none';
    document.getElementById('loginCard').style.display = 'block';
}

function handleSignup() {
    console.log('Signup function called');
    
    var username = document.getElementById('signupUser').value.trim();
    var whatsapp = document.getElementById('signupWA').value.trim();
    var password = document.getElementById('signupPass').value.trim();
    var referralCode = document.getElementById('signupRef').value.trim();

    console.log('Values:', username, whatsapp, password, referralCode);

    if (!username) {
        return showToast('Please enter username', 'e');
    }
    if (!whatsapp) {
        return showToast('Please enter WhatsApp number', 'e');
    }
    if (!password) {
        return showToast('Please enter password', 'e');
    }
    if (password.length < 6) {
        return showToast('Password must be 6+ characters', 'e');
    }

    showToast('Creating account...', 'i');

    // Disable button
    var btn = event.target;
    btn.disabled = true;
    btn.textContent = '⏳ Please wait...';

    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + '/api/signup', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    
    xhr.onload = function() {
        btn.disabled = false;
        btn.textContent = '✨ Create Account';
        
        console.log('Response:', xhr.status, xhr.responseText);
        
        try {
            var data = JSON.parse(xhr.responseText);
            if (data.success) {
                authToken = data.token;
                localStorage.setItem('p24_token', authToken);
                goToDashboard();
                showToast('Welcome! Account created! 🎉', 's');
            } else {
                showToast(data.error || 'Registration failed', 'e');
            }
        } catch(e) {
            console.error('Parse error:', e);
            showToast('Server error. Please try again.', 'e');
        }
    };
    
    xhr.onerror = function() {
        btn.disabled = false;
        btn.textContent = '✨ Create Account';
        console.error('Network error');
        showToast('Network error! Check your connection.', 'e');
    };
    
    xhr.send(JSON.stringify({
        username: username,
        whatsapp: whatsapp,
        password: password,
        referralCode: referralCode
    }));
}

function handleLogin() {
    console.log('Login function called');
    
    var username = document.getElementById('loginUser').value.trim();
    var password = document.getElementById('loginPass').value.trim();

    console.log('Values:', username, password);

    if (!username) {
        return showToast('Please enter username', 'e');
    }
    if (!password) {
        return showToast('Please enter password', 'e');
    }

    showToast('Signing in...', 'i');

    // Disable button
    var btn = event.target;
    btn.disabled = true;
    btn.textContent = '⏳ Please wait...';

    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + '/api/login', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    
    xhr.onload = function() {
        btn.disabled = false;
        btn.textContent = '🚀 Sign In';
        
        console.log('Response:', xhr.status, xhr.responseText);
        
        try {
            var data = JSON.parse(xhr.responseText);
            if (data.success) {
                authToken = data.token;
                localStorage.setItem('p24_token', authToken);
                goToDashboard();
                showToast('Welcome back! 👋', 's');
            } else {
                showToast(data.error || 'Login failed', 'e');
            }
        } catch(e) {
            console.error('Parse error:', e);
            showToast('Server error. Please try again.', 'e');
        }
    };
    
    xhr.onerror = function() {
        btn.disabled = false;
        btn.textContent = '🚀 Sign In';
        console.error('Network error');
        showToast('Network error! Check your connection.', 'e');
    };
    
    xhr.send(JSON.stringify({
        username: username,
        password: password
    }));
}

function handleLogout() { 
    localStorage.removeItem('p24_token'); 
    authToken = null; 
    hideAllPages(); 
    showPage('authSection');
    showLoginForm(); 
    showToast('Logged out', 'i'); 
}

// ============================================================
// DASHBOARD
// ============================================================

function loadDashboardData() {
    if (!authToken) { 
        hideAllPages(); 
        showPage('authSection');
        showLoginForm();
        return; 
    }
    
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/dashboard', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() {
        try {
            var d = JSON.parse(xhr.responseText);
            if (d.success) {
                document.getElementById('dashUser').textContent = '👋 Welcome, ' + d.username;
                document.getElementById('dashPID').textContent = d.pid || '---';
                document.getElementById('dashBal').textContent = (d.balance || 0).toFixed(2);
                document.getElementById('sToday').textContent = 'PKR ' + fmt(d.todayProfit);
                document.getElementById('sInv').textContent = 'PKR ' + fmt(d.totalInvested);
                document.getElementById('sEarn').textContent = 'PKR ' + fmt(d.totalEarned);
                document.getElementById('sRefs').textContent = d.referralCount || 0;
                document.getElementById('sRefBonus').textContent = 'PKR ' + fmt(d.referralEarnings);
                document.getElementById('sDepPen').textContent = d.pendingDeposits || 0;
                document.getElementById('sWdPen').textContent = d.pendingWithdrawals || 0;
                document.getElementById('sWdTotal').textContent = 'PKR ' + fmt(d.totalWithdrawn);
                document.getElementById('refLink').textContent = window.location.origin + '?ref=' + d.referralCode;
                
                // Update withdraw/transfer balance
                if (document.getElementById('wdBalance')) {
                    document.getElementById('wdBalance').textContent = 'PKR ' + (d.balance || 0).toFixed(2);
                }
                if (document.getElementById('tfBalance')) {
                    document.getElementById('tfBalance').textContent = 'PKR ' + (d.balance || 0).toFixed(2);
                }
            }
        } catch(e) {
            console.error('Dashboard error:', e);
        }
    };
    xhr.onerror = function() {
        console.error('Dashboard network error');
    };
    xhr.send();
}

// ============================================================
// DEPOSIT FLOW
// ============================================================

function openDeposit() { 
    hideAllPages(); 
    showPage('plansSection'); 
    loadPlansList(); 
}

function loadPlansList() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/plans', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() {
        try {
            var d = JSON.parse(xhr.responseText);
            if (d.success && d.plans) {
                var html = '';
                for (var i = 0; i < d.plans.length; i++) {
                    var p = d.plans[i];
                    var totalReturn = p.amount * (p.dailyProfit / 100) * p.duration;
                    html += '<div class="glass plan-card" onclick="choosePlan(' + p.planId + ',' + p.amount + ',\'' + p.name + '\')">';
                    html += '<div class="plan-name">' + p.name + '</div>';
                    html += '<div class="plan-amount">PKR ' + fmt(p.amount) + '</div>';
                    html += '<div class="plan-info">📈 ' + p.dailyProfit + '% Daily | 📅 ' + p.duration + ' Days</div>';
                    html += '<div class="plan-info">💎 Total: PKR ' + fmt(totalReturn) + '</div>';
                    html += '</div>';
                }
                document.getElementById('plansGrid').innerHTML = html;
            }
        } catch(e) {
            console.error('Plans error:', e);
        }
    };
    xhr.send();
}

function choosePlan(id, amt, name) {
    selectedPlan = { id: id, amt: amt, name: name };
    
    var cards = document.querySelectorAll('.plan-card');
    for (var i = 0; i < cards.length; i++) {
        cards[i].classList.remove('selected');
    }
    
    if (event && event.target) {
        var card = event.target.closest('.plan-card');
        if (card) card.classList.add('selected');
    }
    
    setTimeout(function() { 
        hideAllPages(); 
        showPage('paymentSection'); 
        showPaymentPage(); 
    }, 300);
}

function showPaymentPage() {
    if (!selectedPlan) return goToPlans();
    document.getElementById('payPlanName').textContent = selectedPlan.name;
    document.getElementById('payPlanAmt').textContent = fmt(selectedPlan.amt);
}

function selectPaymentMethod(method) { 
    selectedPayment = method; 
    hideAllPages(); 
    showPage('depositSection'); 
    document.getElementById('depMethod').textContent = method.toUpperCase(); 
    loadAccountInfo(method); 
}

function loadAccountInfo(method) {
    if (accountData) { 
        showAccountInfo(method); 
        return; 
    }
    
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/deposit-accounts', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() { 
        try { 
            var d = JSON.parse(xhr.responseText); 
            if (d.success) { 
                accountData = d; 
                showAccountInfo(method); 
            } 
        } catch(e) { 
            console.error('Account error:', e);
        } 
    };
    xhr.send();
}

function showAccountInfo(method) {
    var a = accountData[method];
    if (!a) return;
    
    document.getElementById('accInfo').innerHTML = 
        '<div class="glass" style="padding:18px;">' +
        '<p>📱 <strong>' + method.toUpperCase() + '</strong></p>' +
        '<p>🔢 Number: <strong>' + a.number + '</strong> ' +
        '<button class="btn-sm" onclick="copyText(\'' + a.number + '\')">📋 Copy</button></p>' +
        '<p>📛 Title: <strong>' + a.title + '</strong></p>' +
        '</div>';
}

function copyText(t) { 
    navigator.clipboard.writeText(t).then(function() {
        showToast('Copied! 📋', 's');
    });
}

function copyReferralLink() { 
    var link = document.getElementById('refLink').textContent;
    navigator.clipboard.writeText(link).then(function() {
        showToast('Link copied! 📋', 's');
    });
}

function submitDepositNow() {
    if (!selectedPlan || !selectedPayment) return showToast('Select plan & method', 'e');
    
    var tx = document.getElementById('depTx').value.trim();
    var fileInput = document.getElementById('depSS');
    
    if (!tx || !fileInput.files || !fileInput.files[0]) {
        return showToast('TxID + Screenshot required', 'e');
    }

    var fd = new FormData();
    fd.append('planId', selectedPlan.id);
    fd.append('accountType', selectedPayment);
    fd.append('txId', tx);
    fd.append('screenshot', fileInput.files[0]);

    showToast('Submitting...', 'i');

    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + '/api/deposit', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() { 
        try { 
            var d = JSON.parse(xhr.responseText); 
            if (d.success) { 
                showToast('Deposit submitted! ✅', 's'); 
                goToDashboard(); 
            } else {
                showToast(d.error || 'Failed', 'e'); 
            }
        } catch(e) { 
            showToast('Error', 'e'); 
        } 
    };
    xhr.onerror = function() {
        showToast('Network error', 'e');
    };
    xhr.send(fd);
}

// ============================================================
// WITHDRAW
// ============================================================

function openWithdraw() { 
    hideAllPages(); 
    showPage('withdrawSection'); 
    loadDashboardData(); 
}

function submitWithdrawNow() {
    var t = document.getElementById('wdType').value;
    var n = document.getElementById('wdNum').value.trim();
    var ti = document.getElementById('wdTitle').value.trim();
    var a = parseFloat(document.getElementById('wdAmt').value);
    
    if (!t || !n || !ti || !a) return showToast('All fields required', 'e');

    showToast('Submitting...', 'i');

    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + '/api/withdraw', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() { 
        try { 
            var d = JSON.parse(xhr.responseText); 
            if (d.success) { 
                showToast('Withdrawal submitted! ✅', 's'); 
                goToDashboard(); 
            } else {
                showToast(d.error, 'e'); 
            }
        } catch(e) { 
            showToast('Error', 'e'); 
        } 
    };
    xhr.onerror = function() {
        showToast('Network error', 'e');
    };
    xhr.send(JSON.stringify({ 
        accountType: t, 
        accountNumber: n, 
        accountTitle: ti, 
        amount: a 
    }));
}

// ============================================================
// FUND TRANSFER
// ============================================================

function openTransfer() { 
    hideAllPages(); 
    showPage('transferSection'); 
    var confirmDiv = document.getElementById('tfConfirm');
    if (confirmDiv) confirmDiv.classList.add('hidden');
    loadDashboardData(); 
}

function verifyReceiverPID() {
    var pid = document.getElementById('tfPID').value.trim();
    var amt = parseFloat(document.getElementById('tfAmt').value);
    
    if (!pid || !amt) return showToast('PID + Amount required', 'e');

    showToast('Verifying...', 'i');

    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + '/api/verify-pid', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() {
        try {
            var d = JSON.parse(xhr.responseText);
            if (d.success) {
                var confirmDiv = document.getElementById('tfConfirm');
                confirmDiv.classList.remove('hidden');
                confirmDiv.innerHTML = 
                    '<div class="glass" style="padding:20px;margin-top:15px;">' +
                    '<h3>✅ Receiver Found</h3>' +
                    '<p>👤 <strong>' + d.user.username + '</strong></p>' +
                    '<p>📱 ' + d.user.whatsapp + '</p>' +
                    '<p>🆔 PID: ' + d.user.pid + '</p>' +
                    '<p style="color:#fbbf24;font-size:20px;font-weight:900;">Amount: PKR ' + fmt(amt) + '</p>' +
                    '<button class="btn" onclick="confirmTransferNow(\'' + pid + '\',' + amt + ')">✅ Confirm Transfer</button>' +
                    '</div>';
            } else {
                showToast(d.error || 'Not found', 'e');
            }
        } catch(e) { 
            showToast('Error', 'e'); 
        }
    };
    xhr.onerror = function() {
        showToast('Network error', 'e');
    };
    xhr.send(JSON.stringify({ pid: pid }));
}

function confirmTransferNow(pid, amt) {
    showToast('Transferring...', 'i');

    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + '/api/fund-transfer', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() { 
        try { 
            var d = JSON.parse(xhr.responseText); 
            if (d.success) { 
                showToast('✅ Transfer successful!', 's'); 
                goToDashboard(); 
            } else {
                showToast(d.error, 'e'); 
            }
        } catch(e) { 
            showToast('Error', 'e'); 
        } 
    };
    xhr.onerror = function() {
        showToast('Network error', 'e');
    };
    xhr.send(JSON.stringify({ receiverPid: pid, amount: amt }));
}

// ============================================================
// MY PLAN
// ============================================================

function checkMyPlan() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/dashboard', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() {
        try { 
            var d = JSON.parse(xhr.responseText); 
            if (d.success && d.activePlan && d.activePlan.planId) { 
                var p = d.activePlan;
                showToast('📋 ' + p.name + '\n💰 Daily: PKR ' + p.dailyProfit.toFixed(2) + '\n📅 Day: ' + p.profitDays + '/60', 'i'); 
            } else {
                showToast('No active plan. Invest first!', 'e'); 
            }
        } catch(e) { 
            console.error('Plan check error:', e);
        }
    };
    xhr.send();
}

// ============================================================
// HISTORY
// ============================================================

function openHistory(type) { 
    hideAllPages(); 
    showPage('historySection'); 
    loadHistoryData(type); 
}

function loadHistoryData(type) {
    var title = type === 'deposits' ? '📥 Deposit History' : type === 'withdrawals' ? '📤 Withdrawal History' : '📊 All Transactions';
    var url = type === 'deposits' ? '/api/deposits' : type === 'withdrawals' ? '/api/withdrawals' : '/api/transactions';
    
    document.getElementById('historyTitle').textContent = title;
    
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + url, true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() { 
        try { 
            var d = JSON.parse(xhr.responseText); 
            var items = d.deposits || d.withdrawals || d.transactions || []; 
            document.getElementById('historyContent').innerHTML = renderHistoryCards(items); 
        } catch(e) { 
            document.getElementById('historyContent').innerHTML = '<p>Error loading data</p>'; 
        }
    };
    xhr.send();
}

function renderHistoryCards(items) {
    if (!items || !items.length) return '<p style="text-align:center;padding:40px;color:rgba(255,255,255,0.5);">No records found</p>';
    
    var h = '';
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var statusClass = 'status-' + (it.status === 'completed' ? 'completed' : it.status);
        var statusIcon = it.status === 'approved' || it.status === 'completed' ? '✅' : it.status === 'rejected' ? '❌' : it.status === 'refunded' ? '↩️' : '⏳';
        var reqDate = new Date(it.createdAt);
        var procDate = it.processedAt ? new Date(it.processedAt) : null;
        var reqTime = reqDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + reqDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        var procTime = procDate ? procDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + procDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '---';
        
        var typeLabel = it.type === 'deposit' ? '📥 DEPOSIT' : it.type === 'withdraw' ? '📤 WITHDRAWAL' : it.type === 'profit' ? '💎 PROFIT' : it.type === 'referral' ? '🎁 REFERRAL' : it.type === 'transfer_sent' ? '🔄 SENT' : it.type === 'transfer_received' ? '🔄 RECEIVED' : it.type === 'refund' ? '↩️ REFUND' : it.type.toUpperCase();
        
        h += '<div class="hist-card">';
        h += '<div class="hist-header"><span class="hist-type">' + typeLabel + '</span><span class="hist-status ' + statusClass + '">' + statusIcon + ' ' + it.status.toUpperCase() + '</span></div>';
        h += '<div class="hist-body">';
        h += '<div class="hist-item"><span class="hist-label">Amount</span><span class="hist-value amount">PKR ' + fmt(it.amount) + '</span></div>';
        
        if (it.fee > 0) h += '<div class="hist-item"><span class="hist-label">Fee</span><span class="hist-value" style="color:#f87171;">PKR ' + fmt(it.fee) + '</span></div>';
        if (it.accountType) h += '<div class="hist-item"><span class="hist-label">Method</span><span class="hist-value">' + it.accountType.toUpperCase() + '</span></div>';
        if (it.txId) h += '<div class="hist-item"><span class="hist-label">TxID</span><span class="hist-value" style="font-size:11px;">' + it.txId + '</span></div>';
        if (it.planName) h += '<div class="hist-item"><span class="hist-label">Plan</span><span class="hist-value">' + it.planName + '</span></div>';
        if (it.relatedUsername) h += '<div class="hist-item"><span class="hist-label">' + (it.type === 'transfer_sent' ? 'To' : 'From') + '</span><span class="hist-value">' + it.relatedUsername + '</span></div>';
        
        h += '</div>';
        h += '<div class="hist-timeline"><span>📅 Requested: <strong>' + reqTime + '</strong></span><span>' + (it.status === 'pending' ? '⏳' : '✅') + ' Processed: <strong>' + procTime + '</strong></span></div>';
        h += '</div>';
    }
    return h;
}

// ============================================================
// TEAM
// ============================================================

function openTeam() { 
    hideAllPages(); 
    showPage('historySection'); 
    loadTeamData(); 
}

function loadTeamData() {
    document.getElementById('historyTitle').textContent = '👥 My Team';
    
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/team', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() {
        try {
            var d = JSON.parse(xhr.responseText);
            var h = '<p style="margin-bottom:20px;font-size:18px;">👥 Total Members: <strong>' + (d.teamCount || 0) + '</strong></p>';
            
            if (d.team && d.team.length > 0) {
                for (var i = 0; i < d.team.length; i++) {
                    var m = d.team[i];
                    h += '<div class="hist-card">';
                    h += '<div class="hist-header"><span>👤 ' + m.username + '</span></div>';
                    h += '<div class="hist-body">';
                    h += '<div class="hist-item"><span class="hist-label">Invested</span><span class="hist-value amount">PKR ' + fmt(m.totalInvested) + '</span></div>';
                    h += '<div class="hist-item"><span class="hist-label">Joined</span><span class="hist-value">' + new Date(m.createdAt).toLocaleDateString() + '</span></div>';
                    h += '</div></div>';
                }
            }
            
            document.getElementById('historyContent').innerHTML = h;
        } catch(e) {
            console.error('Team error:', e);
        }
    };
    xhr.send();
}

// ============================================================
// PROFILE
// ============================================================

function openProfile() {
    hideAllPages(); 
    showPage('profileSection');
    
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/profile', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() {
        try {
            var d = JSON.parse(xhr.responseText);
            if (d.success) {
                document.getElementById('pfPID').textContent = d.user.pid;
                document.getElementById('pfWA').value = d.user.whatsapp || '';
            }
        } catch(e) {
            console.error('Profile error:', e);
        }
    };
    xhr.send();
}

function saveProfile() {
    var fd = new FormData();
    var wa = document.getElementById('pfWA').value.trim();
    var pass = document.getElementById('pfPass').value.trim();
    
    if (wa) fd.append('whatsapp', wa);
    if (pass) fd.append('password', pass);
    
    if (!wa && !pass) return showToast('No changes made', 'e');

    showToast('Saving...', 'i');

    var xhr = new XMLHttpRequest();
    xhr.open('PUT', API_URL + '/api/profile', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() {
        try {
            var d = JSON.parse(xhr.responseText);
            if (d.success) {
                showToast('Profile updated! ✅', 's');
                goToDashboard();
            } else {
                showToast(d.error || 'Failed', 'e');
            }
        } catch(e) {
            showToast('Error', 'e');
        }
    };
    xhr.onerror = function() {
        showToast('Network error', 'e');
    };
    xhr.send(fd);
}

// ============================================================
// LEADERBOARD
// ============================================================

function openLeaderboard() { 
    hideAllPages(); 
    showPage('leaderboardSection'); 
    loadLeaderboardData(); 
}

function loadLeaderboardData() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/leaderboard', true);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.onload = function() {
        try {
            var d = JSON.parse(xhr.responseText);
            var h1 = '', h2 = '';
            
            if (d.topInvestors && d.topInvestors.length > 0) {
                for (var i = 0; i < d.topInvestors.length; i++) {
                    h1 += '<p>' + (i + 1) + '. 🏅 ' + d.topInvestors[i].username + ' - PKR ' + fmt(d.topInvestors[i].totalInvested) + '</p>';
                }
            }
            
            if (d.topReferrers && d.topReferrers.length > 0) {
                for (var j = 0; j < d.topReferrers.length; j++) {
                    h2 += '<p>' + (j + 1) + '. 🔗 ' + d.topReferrers[j].username + ' - ' + (d.topReferrers[j].count || 0) + ' referrals</p>';
                }
            }
            
            document.getElementById('topInv').innerHTML = h1 || '<p>No data available</p>';
            document.getElementById('topRef').innerHTML = h2 || '<p>No data available</p>';
        } catch(e) {
            console.error('Leaderboard error:', e);
        }
    };
    xhr.send();
}

// ============================================================
// FAQ
// ============================================================

function openFAQ() { 
    hideAllPages(); 
    showPage('faqSection'); 
    loadFAQData(); 
}

function loadFAQData() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API_URL + '/api/faqs', true);
    xhr.onload = function() {
        try {
            var d = JSON.parse(xhr.responseText);
            if (d.faqs && d.faqs.length > 0) {
                var h = '';
                for (var i = 0; i < d.faqs.length; i++) {
                    h += '<div class="glass form-card" style="margin:14px 0;">';
                    h += '<h3 style="color:#a78bfa;margin-bottom:10px;">❓ ' + d.faqs[i].question + '</h3>';
                    h += '<p style="color:rgba(255,255,255,0.7);line-height:1.6;">' + d.faqs[i].answer + '</p>';
                    h += '</div>';
                }
                document.getElementById('faqContent').innerHTML = h;
            } else {
                document.getElementById('faqContent').innerHTML = '<p style="text-align:center;padding:30px;color:rgba(255,255,255,0.5);">No FAQs available</p>';
            }
        } catch(e) {
            console.error('FAQ error:', e);
        }
    };
    xhr.send();
}

// ============================================================
// SUPPORT MODAL
// ============================================================

function openSupport() { 
    var modal = document.getElementById('supportModal');
    if (modal) modal.classList.remove('hidden'); 
}

function closeSupportModal() { 
    var modal = document.getElementById('supportModal');
    if (modal) modal.classList.add('hidden'); 
}

// ============================================================
// CHAT WIDGET
// ============================================================

function openChatWidget() { 
    closeSupportModal(); 
    var chat = document.getElementById('chatWidget');
    if (chat) chat.classList.remove('hidden'); 
}

function closeChatWidget() { 
    var chat = document.getElementById('chatWidget');
    if (chat) chat.classList.add('hidden'); 
}

function sendChatMessage() {
    var input = document.getElementById('chatInput');
    var msg = input.value.trim();
    if (!msg) return;
    
    var body = document.getElementById('chatBody');
    body.innerHTML += '<div class="chat-msg user">' + msg + '</div>';
    input.value = '';
    body.scrollTop = body.scrollHeight;
    
    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + '/api/chat', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() {
        try {
            var d = JSON.parse(xhr.responseText);
            if (d.success) {
                body.innerHTML += '<div class="chat-msg bot">' + d.reply + '</div>';
                body.scrollTop = body.scrollHeight;
            }
        } catch(e) {
            console.error('Chat error:', e);
        }
    };
    xhr.send(JSON.stringify({ message: msg }));
}

// ============================================================
// PAGE INITIALIZATION
// ============================================================
console.log('Profit 24 App Initializing...');
console.log('Token exists:', !!authToken);

if (authToken) {
    hideAllPages();
    showPage('dashSection');
    loadDashboardData();
    console.log('User logged in - showing dashboard');
} else {
    hideAllPages();
    showPage('authSection');
    showLoginForm();
    console.log('No token - showing login page');
}
