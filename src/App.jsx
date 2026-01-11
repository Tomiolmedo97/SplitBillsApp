import { useState, useEffect, useRef } from 'react';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';

// ============== UTILITIES ==============
const formatMoney = (amount) => {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

const parseAmount = (str) => {
  return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
};

const formatInput = (value) => {
  const num = value.replace(/[^\d]/g, '');
  return num ? parseInt(num).toLocaleString('es-AR') : '';
};

// ============== CALCULATIONS ==============
const calculateSplits = (participants, expenses) => {
  if (participants.length < 2 || expenses.length === 0) return null;

  const balances = {};
  participants.forEach(p => {
    balances[p.id] = { paid: 0, owes: 0, name: p.name, paymentInfo: p.paymentInfo };
  });

  let totalSpent = 0;

  expenses.forEach(expense => {
    const payer = expense.paidBy;
    const sharedBy = expense.sharedBy.length > 0 ? expense.sharedBy : participants.map(p => p.id);
    const splitAmount = expense.amount / sharedBy.length;

    totalSpent += expense.amount;
    
    if (balances[payer]) {
      balances[payer].paid += expense.amount;
    }

    sharedBy.forEach(pid => {
      if (balances[pid]) {
        balances[pid].owes += splitAmount;
      }
    });
  });

  const balanceArray = Object.entries(balances).map(([id, data]) => ({
    id: parseInt(id),
    name: data.name,
    paymentInfo: data.paymentInfo,
    paid: data.paid,
    owes: data.owes,
    balance: data.paid - data.owes
  }));

  const debtors = balanceArray.filter(p => p.balance < -0.01).map(p => ({ ...p, remaining: Math.abs(p.balance) }));
  const creditors = balanceArray.filter(p => p.balance > 0.01).map(p => ({ ...p, remaining: p.balance }));

  const transactions = [];
  
  debtors.sort((a, b) => b.remaining - a.remaining);
  creditors.sort((a, b) => b.remaining - a.remaining);

  debtors.forEach(debtor => {
    creditors.forEach(creditor => {
      if (debtor.remaining > 0.01 && creditor.remaining > 0.01) {
        const amount = Math.min(debtor.remaining, creditor.remaining);
        if (amount > 0.01) {
          transactions.push({
            from: debtor.name,
            fromId: debtor.id,
            to: creditor.name,
            toId: creditor.id,
            toPaymentInfo: creditor.paymentInfo,
            amount: Math.round(amount)
          });
          debtor.remaining -= amount;
          creditor.remaining -= amount;
        }
      }
    });
  });

  return { totalSpent, balances: balanceArray, transactions };
};

// ============== SHARE TEXT ==============
const generateShareText = (participants, expenses, results, eventName) => {
  const date = new Date().toLocaleDateString('es-AR');
  let text = `💰 *${eventName || 'División de gastos'}*\n`;
  text += `📅 ${date}\n\n`;
  
  text += `📋 *Gastos:*\n`;
  expenses.forEach(exp => {
    const payer = participants.find(p => p.id === exp.paidBy);
    const sharedByNames = exp.sharedBy.length === participants.length || exp.sharedBy.length === 0
      ? 'Todos'
      : exp.sharedBy.map(id => participants.find(p => p.id === id)?.name).join(', ');
    text += `• ${exp.description}: ${formatMoney(exp.amount)} (pagó ${payer?.name || '?'}) - ${sharedByNames}\n`;
  });
  
  text += `\n💵 *Total:* ${formatMoney(results.totalSpent)}\n\n`;
  
  if (results.transactions.length > 0) {
    text += `💸 *Movimientos:*\n`;
    results.transactions.forEach(t => {
      text += `→ ${t.from} paga ${formatMoney(t.amount)} a ${t.to}`;
      if (t.toPaymentInfo) text += ` (${t.toPaymentInfo})`;
      text += `\n`;
    });
  } else {
    text += `✅ ¡Todo equilibrado!\n`;
  }
  
  return text;
};

// ============== EXPORT FUNCTIONS ==============
const exportToPDF = (participants, expenses, results, eventName) => {
  const doc = new jsPDF();
  const date = new Date().toLocaleDateString('es-AR');
  let y = 20;
  
  // Title
  doc.setFontSize(22);
  doc.setTextColor(233, 69, 96);
  doc.text(eventName || 'División de Gastos', 105, y, { align: 'center' });
  
  y += 10;
  doc.setFontSize(12);
  doc.setTextColor(100);
  doc.text(date, 105, y, { align: 'center' });
  
  // Summary
  y += 20;
  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.text('Resumen', 20, y);
  
  y += 10;
  doc.setFontSize(11);
  doc.text(`Total gastado: ${formatMoney(results.totalSpent)}`, 20, y);
  y += 7;
  doc.text(`Participantes: ${participants.length}`, 20, y);
  y += 7;
  doc.text(`Promedio por persona: ${formatMoney(results.totalSpent / participants.length)}`, 20, y);
  
  // Expenses
  y += 15;
  doc.setFontSize(14);
  doc.text('Detalle de Gastos', 20, y);
  
  y += 10;
  doc.setFontSize(10);
  expenses.forEach(exp => {
    const payer = participants.find(p => p.id === exp.paidBy);
    const sharedCount = exp.sharedBy.length === 0 ? participants.length : exp.sharedBy.length;
    doc.text(`• ${exp.description}: ${formatMoney(exp.amount)} (${payer?.name}) - ${sharedCount} personas`, 20, y);
    y += 6;
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
  });
  
  // Balances
  y += 10;
  doc.setFontSize(14);
  doc.text('Balance Individual', 20, y);
  
  y += 10;
  doc.setFontSize(10);
  results.balances.forEach(b => {
    const status = b.balance > 0 ? `recibe ${formatMoney(b.balance)}` : 
                   b.balance < 0 ? `debe ${formatMoney(Math.abs(b.balance))}` : 'equilibrado';
    doc.text(`• ${b.name}: Pagó ${formatMoney(b.paid)} - ${status}`, 20, y);
    y += 6;
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
  });
  
  // Transactions
  if (results.transactions.length > 0) {
    y += 10;
    doc.setFontSize(14);
    doc.text('Movimientos a Realizar', 20, y);
    
    y += 10;
    doc.setFontSize(11);
    doc.setTextColor(233, 69, 96);
    results.transactions.forEach(t => {
      let text = `→ ${t.from} paga ${formatMoney(t.amount)} a ${t.to}`;
      if (t.toPaymentInfo) text += ` (${t.toPaymentInfo})`;
      doc.text(text, 20, y);
      y += 8;
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
    });
  }
  
  // Footer
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text('Generado con Dividir Gastos App', 105, 290, { align: 'center' });
  
  doc.save(`${eventName || 'gastos'}-${date.replace(/\//g, '-')}.pdf`);
};

const exportToExcel = (participants, expenses, results, eventName) => {
  const date = new Date().toLocaleDateString('es-AR');
  
  // Sheet 1: Resumen
  const summaryData = [
    ['DIVISIÓN DE GASTOS'],
    [eventName || 'Sin nombre'],
    ['Fecha:', date],
    [''],
    ['RESUMEN'],
    ['Total gastado:', results.totalSpent],
    ['Participantes:', participants.length],
    ['Promedio por persona:', Math.round(results.totalSpent / participants.length)]
  ];
  
  // Sheet 2: Gastos
  const expensesData = [
    ['Descripción', 'Monto', 'Pagó', 'Dividido entre', 'Cantidad personas']
  ];
  expenses.forEach(exp => {
    const payer = participants.find(p => p.id === exp.paidBy);
    const sharedByNames = exp.sharedBy.length === 0 || exp.sharedBy.length === participants.length
      ? 'Todos'
      : exp.sharedBy.map(id => participants.find(p => p.id === id)?.name).join(', ');
    const count = exp.sharedBy.length === 0 ? participants.length : exp.sharedBy.length;
    expensesData.push([exp.description, exp.amount, payer?.name || '', sharedByNames, count]);
  });
  
  // Sheet 3: Balances
  const balancesData = [
    ['Participante', 'Pagó', 'Debe', 'Balance', 'Datos de pago']
  ];
  results.balances.forEach(b => {
    balancesData.push([b.name, b.paid, Math.round(b.owes), Math.round(b.balance), b.paymentInfo || '']);
  });
  
  // Sheet 4: Movimientos
  const transactionsData = [
    ['De', 'Para', 'Monto', 'Datos de pago']
  ];
  results.transactions.forEach(t => {
    transactionsData.push([t.from, t.to, t.amount, t.toPaymentInfo || '']);
  });
  
  // Create workbook
  const wb = XLSX.utils.book_new();
  
  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, ws1, 'Resumen');
  
  const ws2 = XLSX.utils.aoa_to_sheet(expensesData);
  XLSX.utils.book_append_sheet(wb, ws2, 'Gastos');
  
  const ws3 = XLSX.utils.aoa_to_sheet(balancesData);
  XLSX.utils.book_append_sheet(wb, ws3, 'Balances');
  
  const ws4 = XLSX.utils.aoa_to_sheet(transactionsData);
  XLSX.utils.book_append_sheet(wb, ws4, 'Movimientos');
  
  XLSX.writeFile(wb, `${eventName || 'gastos'}-${date.replace(/\//g, '-')}.xlsx`);
};

// ============== COMPONENTS ==============
const TabButton = ({ active, onClick, children, icon }) => (
  <button
    onClick={onClick}
    style={{
      flex: 1,
      padding: '14px 8px',
      background: active ? 'rgba(233, 69, 96, 0.2)' : 'transparent',
      border: 'none',
      borderBottom: active ? '3px solid #e94560' : '3px solid transparent',
      color: active ? '#e94560' : 'rgba(255, 255, 255, 0.5)',
      fontSize: '13px',
      fontWeight: '600',
      fontFamily: 'Outfit, sans-serif',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '4px'
    }}
  >
    <span style={{ fontSize: '20px' }}>{icon}</span>
    {children}
  </button>
);

const Card = ({ children, style }) => (
  <div style={{
    background: 'rgba(255, 255, 255, 0.05)',
    backdropFilter: 'blur(10px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '20px',
    padding: '20px',
    marginBottom: '16px',
    ...style
  }}>
    {children}
  </div>
);

const Input = ({ ...props }) => (
  <input
    {...props}
    style={{
      width: '100%',
      padding: '14px 16px',
      background: 'rgba(255, 255, 255, 0.08)',
      border: '2px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '12px',
      color: 'white',
      fontSize: '15px',
      fontFamily: 'Outfit, sans-serif',
      outline: 'none',
      transition: 'all 0.2s ease',
      ...props.style
    }}
  />
);

const Button = ({ primary, children, ...props }) => (
  <button
    {...props}
    style={{
      padding: primary ? '16px' : '12px 16px',
      background: primary 
        ? 'linear-gradient(135deg, #e94560 0%, #ff6b6b 100%)'
        : 'rgba(255, 255, 255, 0.1)',
      border: primary ? 'none' : '1px solid rgba(255, 255, 255, 0.2)',
      borderRadius: '12px',
      color: 'white',
      fontSize: '15px',
      fontWeight: '600',
      fontFamily: 'Outfit, sans-serif',
      cursor: props.disabled ? 'not-allowed' : 'pointer',
      opacity: props.disabled ? 0.5 : 1,
      transition: 'all 0.2s ease',
      width: primary ? '100%' : 'auto',
      boxShadow: primary ? '0 8px 24px rgba(233, 69, 96, 0.3)' : 'none',
      ...props.style
    }}
  >
    {children}
  </button>
);

const Checkbox = ({ checked, onChange, label }) => (
  <label style={{
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    background: checked ? 'rgba(233, 69, 96, 0.15)' : 'rgba(255, 255, 255, 0.03)',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    border: checked ? '1px solid rgba(233, 69, 96, 0.3)' : '1px solid transparent'
  }}>
    <div style={{
      width: '22px',
      height: '22px',
      borderRadius: '6px',
      background: checked ? '#e94560' : 'rgba(255, 255, 255, 0.1)',
      border: checked ? 'none' : '2px solid rgba(255, 255, 255, 0.3)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.2s ease',
      flexShrink: 0
    }}>
      {checked && <span style={{ color: 'white', fontSize: '14px' }}>✓</span>}
    </div>
    <span style={{ color: 'white', fontSize: '14px' }}>{label}</span>
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      style={{ display: 'none' }}
    />
  </label>
);

const InstallBanner = ({ onInstall, onDismiss }) => (
  <div style={{
    position: 'fixed',
    bottom: '20px',
    left: '16px',
    right: '16px',
    maxWidth: '468px',
    margin: '0 auto',
    padding: '16px',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    border: '1px solid rgba(233, 69, 96, 0.3)',
    borderRadius: '16px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    zIndex: 1000,
    animation: 'slideUp 0.3s ease'
  }}>
    <style>{`
      @keyframes slideUp {
        from { transform: translateY(100px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `}</style>
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{ fontSize: '32px' }}>📲</div>
      <div style={{ flex: 1 }}>
        <div style={{ color: 'white', fontWeight: '600', marginBottom: '4px' }}>
          Instalar App
        </div>
        <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '13px' }}>
          Accedé más rápido y usala sin internet
        </div>
      </div>
    </div>
    <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
      <Button onClick={onDismiss} style={{ flex: 1 }}>Ahora no</Button>
      <Button primary onClick={onInstall} style={{ flex: 1 }}>Instalar</Button>
    </div>
  </div>
);

// ============== MAIN APP ==============
export default function App() {
  // State
  const [activeTab, setActiveTab] = useState('participants');
  const [eventName, setEventName] = useState('');
  const [participants, setParticipants] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [transferReceipts, setTransferReceipts] = useState({});
  
  // Form states
  const [newParticipant, setNewParticipant] = useState({ name: '', paymentInfo: '' });
  const [newExpense, setNewExpense] = useState({ 
    description: '', 
    amount: '', 
    paidBy: null, 
    sharedBy: [],
    receipt: null 
  });
  const [editingParticipant, setEditingParticipant] = useState(null);
  const [editingExpense, setEditingExpense] = useState(null);
  
  // PWA install
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  
  const fileInputRef = useRef(null);
  const receiptInputRef = useRef(null);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('splitGastosData');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setEventName(data.eventName || '');
        setParticipants(data.participants || []);
        setExpenses(data.expenses || []);
        setTransferReceipts(data.transferReceipts || {});
      } catch (e) {
        console.error('Error loading saved data:', e);
      }
    }
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    const data = { eventName, participants, expenses, transferReceipts };
    localStorage.setItem('splitGastosData', JSON.stringify(data));
  }, [eventName, participants, expenses, transferReceipts]);

  // PWA install prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      // Show banner after 3 seconds
      setTimeout(() => setShowInstallBanner(true), 3000);
    };
    
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
    setShowInstallBanner(false);
  };

  // Handlers
  const addParticipant = () => {
    if (newParticipant.name.trim()) {
      const newP = {
        id: Date.now(),
        name: newParticipant.name.trim(),
        paymentInfo: newParticipant.paymentInfo.trim()
      };
      setParticipants([...participants, newP]);
      setNewParticipant({ name: '', paymentInfo: '' });
    }
  };

  const updateParticipant = () => {
    if (editingParticipant && editingParticipant.name.trim()) {
      setParticipants(participants.map(p => 
        p.id === editingParticipant.id ? editingParticipant : p
      ));
      setEditingParticipant(null);
    }
  };

  const removeParticipant = (id) => {
    setParticipants(participants.filter(p => p.id !== id));
    setExpenses(expenses.map(e => ({
      ...e,
      paidBy: e.paidBy === id ? null : e.paidBy,
      sharedBy: e.sharedBy.filter(pid => pid !== id)
    })).filter(e => e.paidBy !== null));
  };

  const addExpense = () => {
    if (newExpense.description.trim() && newExpense.amount && newExpense.paidBy) {
      const exp = {
        id: Date.now(),
        description: newExpense.description.trim(),
        amount: parseAmount(newExpense.amount),
        paidBy: newExpense.paidBy,
        sharedBy: newExpense.sharedBy.length > 0 ? newExpense.sharedBy : participants.map(p => p.id),
        receipt: newExpense.receipt
      };
      setExpenses([...expenses, exp]);
      setNewExpense({ description: '', amount: '', paidBy: null, sharedBy: [], receipt: null });
    }
  };

  const updateExpense = () => {
    if (editingExpense) {
      setExpenses(expenses.map(e => 
        e.id === editingExpense.id ? {
          ...editingExpense,
          amount: typeof editingExpense.amount === 'string' 
            ? parseAmount(editingExpense.amount) 
            : editingExpense.amount
        } : e
      ));
      setEditingExpense(null);
    }
  };

  const removeExpense = (id) => {
    setExpenses(expenses.filter(e => e.id !== id));
  };

  const handleImageUpload = (e, isReceipt = false, transactionKey = null) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (transactionKey) {
          setTransferReceipts(prev => ({ ...prev, [transactionKey]: reader.result }));
        } else if (isReceipt && editingExpense) {
          setEditingExpense({ ...editingExpense, receipt: reader.result });
        } else if (isReceipt) {
          setNewExpense({ ...newExpense, receipt: reader.result });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleSharedBy = (participantId, isEditing = false) => {
    if (isEditing && editingExpense) {
      const current = editingExpense.sharedBy;
      const updated = current.includes(participantId)
        ? current.filter(id => id !== participantId)
        : [...current, participantId];
      setEditingExpense({ ...editingExpense, sharedBy: updated });
    } else {
      const current = newExpense.sharedBy;
      const updated = current.includes(participantId)
        ? current.filter(id => id !== participantId)
        : [...current, participantId];
      setNewExpense({ ...newExpense, sharedBy: updated });
    }
  };

  const selectAllSharedBy = (isEditing = false) => {
    const allIds = participants.map(p => p.id);
    if (isEditing && editingExpense) {
      setEditingExpense({ ...editingExpense, sharedBy: allIds });
    } else {
      setNewExpense({ ...newExpense, sharedBy: allIds });
    }
  };

  const clearAllData = () => {
    if (window.confirm('¿Seguro que querés borrar todos los datos? Esta acción no se puede deshacer.')) {
      setEventName('');
      setParticipants([]);
      setExpenses([]);
      setTransferReceipts({});
      localStorage.removeItem('splitGastosData');
    }
  };

  const results = calculateSplits(participants, expenses);

  const shareResults = async () => {
    if (!results) return;
    const text = generateShareText(participants, expenses, results, eventName);
    
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch (err) {
        navigator.clipboard.writeText(text);
        alert('¡Copiado al portapapeles!');
      }
    } else {
      navigator.clipboard.writeText(text);
      alert('¡Copiado al portapapeles!');
    }
  };

  const shareToWhatsApp = () => {
    if (!results) return;
    const text = generateShareText(participants, expenses, results, eventName);
    const encoded = encodeURIComponent(text);
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      fontFamily: "'Outfit', sans-serif",
      paddingBottom: '100px'
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }
        input:focus, select:focus { border-color: #e94560 !important; background: rgba(233, 69, 96, 0.1) !important; }
        input::placeholder { color: rgba(255, 255, 255, 0.4); }
        select { appearance: none; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
      `}</style>

      <div style={{ maxWidth: '500px', margin: '0 auto', padding: '0 16px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', padding: '24px 0 16px' }}>
          <div style={{
            width: '64px',
            height: '64px',
            background: 'linear-gradient(135deg, #e94560 0%, #ff6b6b 100%)',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            fontSize: '28px',
            boxShadow: '0 12px 40px rgba(233, 69, 96, 0.4)'
          }}>
            💰
          </div>
          <input
            type="text"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="Nombre del evento..."
            style={{
              background: 'transparent',
              border: 'none',
              color: 'white',
              fontSize: '22px',
              fontWeight: '700',
              textAlign: 'center',
              width: '100%',
              outline: 'none',
              fontFamily: 'Outfit, sans-serif'
            }}
          />
          <p style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '13px', margin: '8px 0 0' }}>
            {participants.length} participantes · {expenses.length} gastos
          </p>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '16px',
          marginBottom: '20px',
          overflow: 'hidden'
        }}>
          <TabButton active={activeTab === 'participants'} onClick={() => setActiveTab('participants')} icon="👥">
            Personas
          </TabButton>
          <TabButton active={activeTab === 'expenses'} onClick={() => setActiveTab('expenses')} icon="🧾">
            Gastos
          </TabButton>
          <TabButton active={activeTab === 'results'} onClick={() => setActiveTab('results')} icon="📊">
            Resultado
          </TabButton>
        </div>

        {/* PARTICIPANTS TAB */}
        {activeTab === 'participants' && (
          <>
            <Card>
              <h3 style={{ color: 'white', fontSize: '16px', margin: '0 0 16px', fontWeight: '600' }}>
                ➕ Agregar participante
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Input
                  placeholder="Nombre (ej: Juan y María)"
                  value={newParticipant.name}
                  onChange={(e) => setNewParticipant({ ...newParticipant, name: e.target.value })}
                  onKeyPress={(e) => e.key === 'Enter' && addParticipant()}
                />
                <Input
                  placeholder="Alias / CBU (opcional)"
                  value={newParticipant.paymentInfo}
                  onChange={(e) => setNewParticipant({ ...newParticipant, paymentInfo: e.target.value })}
                  onKeyPress={(e) => e.key === 'Enter' && addParticipant()}
                />
                <Button primary onClick={addParticipant} disabled={!newParticipant.name.trim()}>
                  Agregar
                </Button>
              </div>
            </Card>

            {participants.length > 0 && (
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ color: 'white', fontSize: '16px', margin: 0, fontWeight: '600' }}>
                    📋 Participantes ({participants.length})
                  </h3>
                  <Button onClick={clearAllData} style={{ padding: '8px 12px', fontSize: '12px' }}>
                    🗑️ Limpiar todo
                  </Button>
                </div>
                {participants.map(p => (
                  <div key={p.id} style={{
                    padding: '14px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '12px',
                    marginBottom: '10px'
                  }}>
                    {editingParticipant?.id === p.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <Input
                          value={editingParticipant.name}
                          onChange={(e) => setEditingParticipant({ ...editingParticipant, name: e.target.value })}
                          style={{ padding: '10px 12px', fontSize: '14px' }}
                        />
                        <Input
                          placeholder="Alias / CBU"
                          value={editingParticipant.paymentInfo}
                          onChange={(e) => setEditingParticipant({ ...editingParticipant, paymentInfo: e.target.value })}
                          style={{ padding: '10px 12px', fontSize: '14px' }}
                        />
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <Button onClick={updateParticipant} style={{ flex: 1 }}>Guardar</Button>
                          <Button onClick={() => setEditingParticipant(null)}>Cancelar</Button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ color: 'white', fontWeight: '500' }}>{p.name}</div>
                          {p.paymentInfo && (
                            <div style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '13px', marginTop: '2px' }}>
                              💳 {p.paymentInfo}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => setEditingParticipant({ ...p })}
                            style={{
                              width: '32px', height: '32px',
                              background: 'rgba(255, 255, 255, 0.1)',
                              border: 'none', borderRadius: '8px',
                              color: 'white', cursor: 'pointer', fontSize: '14px'
                            }}
                          >✏️</button>
                          <button
                            onClick={() => removeParticipant(p.id)}
                            style={{
                              width: '32px', height: '32px',
                              background: 'rgba(248, 113, 113, 0.2)',
                              border: 'none', borderRadius: '8px',
                              color: '#f87171', cursor: 'pointer', fontSize: '16px'
                            }}
                          >×</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </Card>
            )}

            {participants.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255, 255, 255, 0.4)' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>👥</div>
                <p>Agregá participantes para comenzar</p>
              </div>
            )}
          </>
        )}

        {/* EXPENSES TAB */}
        {activeTab === 'expenses' && (
          <>
            {participants.length < 2 ? (
              <Card style={{ textAlign: 'center', padding: '40px' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>⚠️</div>
                <p style={{ color: 'rgba(255, 255, 255, 0.6)', margin: 0 }}>
                  Necesitás al menos 2 participantes para agregar gastos
                </p>
                <Button onClick={() => setActiveTab('participants')} style={{ marginTop: '16px' }}>
                  Ir a Participantes
                </Button>
              </Card>
            ) : (
              <>
                <Card>
                  <h3 style={{ color: 'white', fontSize: '16px', margin: '0 0 16px', fontWeight: '600' }}>
                    ➕ Agregar gasto
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <Input
                      placeholder="Descripción (ej: Pizza, Bebidas)"
                      value={newExpense.description}
                      onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                    />
                    <Input
                      placeholder="Monto"
                      value={newExpense.amount ? `$ ${newExpense.amount}` : ''}
                      onChange={(e) => setNewExpense({ ...newExpense, amount: formatInput(e.target.value) })}
                    />
                    
                    <div>
                      <label style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '13px', marginBottom: '8px', display: 'block' }}>
                        ¿Quién pagó?
                      </label>
                      <select
                        value={newExpense.paidBy || ''}
                        onChange={(e) => setNewExpense({ ...newExpense, paidBy: parseInt(e.target.value) || null })}
                        style={{
                          width: '100%',
                          padding: '14px 16px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: '2px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '12px',
                          color: 'white',
                          fontSize: '15px',
                          fontFamily: 'Outfit, sans-serif',
                          outline: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="" style={{ background: '#1a1a2e' }}>Seleccionar...</option>
                        {participants.map(p => (
                          <option key={p.id} value={p.id} style={{ background: '#1a1a2e' }}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <label style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '13px' }}>
                          ¿Entre quiénes se divide?
                        </label>
                        <button
                          onClick={() => selectAllSharedBy(false)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#e94560',
                            fontSize: '12px',
                            cursor: 'pointer',
                            fontFamily: 'Outfit, sans-serif'
                          }}
                        >
                          Seleccionar todos
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {participants.map(p => (
                          <Checkbox
                            key={p.id}
                            checked={newExpense.sharedBy.includes(p.id)}
                            onChange={() => toggleSharedBy(p.id, false)}
                            label={p.name}
                          />
                        ))}
                      </div>
                      {newExpense.sharedBy.length === 0 && (
                        <p style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '12px', margin: '8px 0 0' }}>
                          Si no seleccionás ninguno, se divide entre todos
                        </p>
                      )}
                    </div>

                    {/* Receipt upload */}
                    <div>
                      <label style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '13px', marginBottom: '8px', display: 'block' }}>
                        📷 Foto del ticket (opcional)
                      </label>
                      {newExpense.receipt ? (
                        <div style={{ position: 'relative' }}>
                          <img
                            src={newExpense.receipt}
                            alt="Receipt"
                            style={{
                              width: '100%',
                              maxHeight: '150px',
                              objectFit: 'cover',
                              borderRadius: '12px'
                            }}
                          />
                          <button
                            onClick={() => setNewExpense({ ...newExpense, receipt: null })}
                            style={{
                              position: 'absolute',
                              top: '8px',
                              right: '8px',
                              width: '28px',
                              height: '28px',
                              background: 'rgba(0,0,0,0.6)',
                              border: 'none',
                              borderRadius: '50%',
                              color: 'white',
                              cursor: 'pointer'
                            }}
                          >×</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          style={{
                            width: '100%',
                            padding: '20px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '2px dashed rgba(255, 255, 255, 0.2)',
                            borderRadius: '12px',
                            color: 'rgba(255, 255, 255, 0.5)',
                            cursor: 'pointer',
                            fontFamily: 'Outfit, sans-serif'
                          }}
                        >
                          📷 Subir imagen
                        </button>
                      )}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleImageUpload(e, true)}
                        style={{ display: 'none' }}
                      />
                    </div>

                    <Button 
                      primary 
                      onClick={addExpense}
                      disabled={!newExpense.description.trim() || !newExpense.amount || !newExpense.paidBy}
                    >
                      Agregar Gasto
                    </Button>
                  </div>
                </Card>

                {expenses.length > 0 && (
                  <Card>
                    <h3 style={{ color: 'white', fontSize: '16px', margin: '0 0 16px', fontWeight: '600' }}>
                      🧾 Gastos ({expenses.length})
                    </h3>
                    {expenses.map(exp => {
                      const payer = participants.find(p => p.id === exp.paidBy);
                      const sharedByAll = exp.sharedBy.length === participants.length || exp.sharedBy.length === 0;
                      
                      return (
                        <div key={exp.id} style={{
                          padding: '14px',
                          background: 'rgba(255, 255, 255, 0.03)',
                          borderRadius: '12px',
                          marginBottom: '10px'
                        }}>
                          {editingExpense?.id === exp.id ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              <Input
                                value={editingExpense.description}
                                onChange={(e) => setEditingExpense({ ...editingExpense, description: e.target.value })}
                                style={{ padding: '10px 12px', fontSize: '14px' }}
                              />
                              <Input
                                value={typeof editingExpense.amount === 'number' 
                                  ? `$ ${editingExpense.amount.toLocaleString('es-AR')}` 
                                  : `$ ${editingExpense.amount}`}
                                onChange={(e) => setEditingExpense({ ...editingExpense, amount: formatInput(e.target.value) })}
                                style={{ padding: '10px 12px', fontSize: '14px' }}
                              />
                              <select
                                value={editingExpense.paidBy || ''}
                                onChange={(e) => setEditingExpense({ ...editingExpense, paidBy: parseInt(e.target.value) })}
                                style={{
                                  padding: '10px 12px',
                                  background: 'rgba(255, 255, 255, 0.08)',
                                  border: '2px solid rgba(255, 255, 255, 0.1)',
                                  borderRadius: '12px',
                                  color: 'white',
                                  fontSize: '14px',
                                  fontFamily: 'Outfit, sans-serif'
                                }}
                              >
                                {participants.map(p => (
                                  <option key={p.id} value={p.id} style={{ background: '#1a1a2e' }}>{p.name}</option>
                                ))}
                              </select>
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                  <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px' }}>Dividir entre:</span>
                                  <button
                                    onClick={() => selectAllSharedBy(true)}
                                    style={{ background: 'none', border: 'none', color: '#e94560', fontSize: '12px', cursor: 'pointer' }}
                                  >Todos</button>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                  {participants.map(p => (
                                    <Checkbox
                                      key={p.id}
                                      checked={editingExpense.sharedBy.includes(p.id)}
                                      onChange={() => toggleSharedBy(p.id, true)}
                                      label={p.name}
                                    />
                                  ))}
                                </div>
                              </div>
                              
                              {/* Receipt in edit mode */}
                              <div>
                                {editingExpense.receipt ? (
                                  <div style={{ position: 'relative' }}>
                                    <img
                                      src={editingExpense.receipt}
                                      alt="Receipt"
                                      style={{ width: '100%', maxHeight: '120px', objectFit: 'cover', borderRadius: '10px' }}
                                    />
                                    <button
                                      onClick={() => setEditingExpense({ ...editingExpense, receipt: null })}
                                      style={{
                                        position: 'absolute', top: '6px', right: '6px',
                                        width: '24px', height: '24px', background: 'rgba(0,0,0,0.6)',
                                        border: 'none', borderRadius: '50%', color: 'white', cursor: 'pointer'
                                      }}
                                    >×</button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => receiptInputRef.current?.click()}
                                    style={{
                                      width: '100%', padding: '12px',
                                      background: 'rgba(255, 255, 255, 0.05)',
                                      border: '2px dashed rgba(255, 255, 255, 0.2)',
                                      borderRadius: '10px', color: 'rgba(255, 255, 255, 0.5)',
                                      cursor: 'pointer', fontSize: '13px'
                                    }}
                                  >📷 Agregar foto</button>
                                )}
                                <input
                                  ref={receiptInputRef}
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => handleImageUpload(e, true)}
                                  style={{ display: 'none' }}
                                />
                              </div>
                              
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <Button onClick={updateExpense} style={{ flex: 1 }}>Guardar</Button>
                                <Button onClick={() => setEditingExpense(null)}>Cancelar</Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ color: 'white', fontWeight: '500', marginBottom: '4px' }}>
                                    {exp.description}
                                  </div>
                                  <div style={{ color: '#4ade80', fontWeight: '700', fontSize: '18px', fontFamily: 'Space Mono, monospace' }}>
                                    {formatMoney(exp.amount)}
                                  </div>
                                  <div style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '12px', marginTop: '6px' }}>
                                    Pagó: {payer?.name || '?'} · {sharedByAll ? 'Entre todos' : `${exp.sharedBy.length} personas`}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  {exp.receipt && (
                                    <button
                                      onClick={() => window.open(exp.receipt, '_blank')}
                                      style={{
                                        width: '32px', height: '32px',
                                        background: 'rgba(255, 255, 255, 0.1)',
                                        border: 'none', borderRadius: '8px',
                                        color: 'white', cursor: 'pointer', fontSize: '14px'
                                      }}
                                    >🖼️</button>
                                  )}
                                  <button
                                    onClick={() => setEditingExpense({ ...exp })}
                                    style={{
                                      width: '32px', height: '32px',
                                      background: 'rgba(255, 255, 255, 0.1)',
                                      border: 'none', borderRadius: '8px',
                                      color: 'white', cursor: 'pointer', fontSize: '14px'
                                    }}
                                  >✏️</button>
                                  <button
                                    onClick={() => removeExpense(exp.id)}
                                    style={{
                                      width: '32px', height: '32px',
                                      background: 'rgba(248, 113, 113, 0.2)',
                                      border: 'none', borderRadius: '8px',
                                      color: '#f87171', cursor: 'pointer', fontSize: '16px'
                                    }}
                                  >×</button>
                                </div>
                              </div>
                              {exp.receipt && (
                                <img
                                  src={exp.receipt}
                                  alt="Receipt"
                                  style={{
                                    width: '100%',
                                    maxHeight: '80px',
                                    objectFit: 'cover',
                                    borderRadius: '8px',
                                    marginTop: '10px',
                                    opacity: 0.8
                                  }}
                                />
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </Card>
                )}

                {expenses.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255, 255, 255, 0.4)' }}>
                    <div style={{ fontSize: '48px', marginBottom: '12px' }}>🧾</div>
                    <p>Agregá gastos para calcular la división</p>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* RESULTS TAB */}
        {activeTab === 'results' && (
          <>
            {!results ? (
              <Card style={{ textAlign: 'center', padding: '40px' }}>
                <div style={{ fontSize: '48px', marginBottom: '12px' }}>📊</div>
                <p style={{ color: 'rgba(255, 255, 255, 0.6)', margin: '0 0 16px' }}>
                  Necesitás al menos 2 participantes y 1 gasto
                </p>
                <Button onClick={() => setActiveTab(participants.length < 2 ? 'participants' : 'expenses')}>
                  {participants.length < 2 ? 'Agregar participantes' : 'Agregar gastos'}
                </Button>
              </Card>
            ) : (
              <>
                {/* Summary */}
                <Card>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: '16px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      borderRadius: '12px'
                    }}>
                      <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
                        Total
                      </div>
                      <div style={{ color: 'white', fontSize: '20px', fontWeight: '700', fontFamily: 'Space Mono, monospace' }}>
                        {formatMoney(results.totalSpent)}
                      </div>
                    </div>
                    <div style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: '16px',
                      background: 'rgba(233, 69, 96, 0.1)',
                      borderRadius: '12px',
                      border: '1px solid rgba(233, 69, 96, 0.2)'
                    }}>
                      <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
                        Promedio
                      </div>
                      <div style={{ color: '#e94560', fontSize: '20px', fontWeight: '700', fontFamily: 'Space Mono, monospace' }}>
                        {formatMoney(results.totalSpent / participants.length)}
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Balances */}
                <Card>
                  <h3 style={{ color: 'white', fontSize: '16px', margin: '0 0 16px', fontWeight: '600' }}>
                    ⚖️ Balance Individual
                  </h3>
                  {results.balances.map(b => (
                    <div key={b.id} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 14px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: '10px',
                      marginBottom: '8px'
                    }}>
                      <div>
                        <div style={{ color: 'white', fontWeight: '500', fontSize: '14px' }}>{b.name}</div>
                        <div style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '12px' }}>
                          Pagó {formatMoney(b.paid)} · Debe {formatMoney(b.owes)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {b.balance > 0.01 ? (
                          <div style={{ color: '#4ade80', fontWeight: '700', fontFamily: 'Space Mono, monospace' }}>
                            +{formatMoney(b.balance)}
                          </div>
                        ) : b.balance < -0.01 ? (
                          <div style={{ color: '#f87171', fontWeight: '700', fontFamily: 'Space Mono, monospace' }}>
                            -{formatMoney(Math.abs(b.balance))}
                          </div>
                        ) : (
                          <div style={{ color: 'rgba(255, 255, 255, 0.5)' }}>✓ OK</div>
                        )}
                      </div>
                    </div>
                  ))}
                </Card>

                {/* Transactions */}
                <Card>
                  <h3 style={{ color: 'white', fontSize: '16px', margin: '0 0 16px', fontWeight: '600' }}>
                    💸 Movimientos
                  </h3>
                  {results.transactions.length > 0 ? (
                    results.transactions.map((t, idx) => {
                      const transactionKey = `${t.fromId}-${t.toId}`;
                      return (
                        <div key={idx} style={{
                          padding: '16px',
                          background: 'linear-gradient(135deg, rgba(233, 69, 96, 0.12) 0%, rgba(255, 107, 107, 0.08) 100%)',
                          border: '1px solid rgba(233, 69, 96, 0.25)',
                          borderRadius: '14px',
                          marginBottom: '12px'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                              width: '40px',
                              height: '40px',
                              background: 'rgba(233, 69, 96, 0.3)',
                              borderRadius: '50%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                            }}>
                              <span style={{ fontSize: '18px' }}>→</span>
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ color: 'white', marginBottom: '4px' }}>
                                <strong>{t.from}</strong>
                                <span style={{ color: 'rgba(255, 255, 255, 0.5)', margin: '0 8px' }}>paga a</span>
                                <strong>{t.to}</strong>
                              </div>
                              <div style={{ color: '#e94560', fontSize: '22px', fontWeight: '700', fontFamily: 'Space Mono, monospace' }}>
                                {formatMoney(t.amount)}
                              </div>
                              {t.toPaymentInfo && (
                                <div style={{
                                  marginTop: '8px',
                                  padding: '8px 12px',
                                  background: 'rgba(255, 255, 255, 0.1)',
                                  borderRadius: '8px',
                                  fontSize: '13px',
                                  color: 'rgba(255, 255, 255, 0.7)'
                                }}>
                                  💳 {t.toPaymentInfo}
                                </div>
                              )}
                            </div>
                          </div>
                          
                          {/* Transfer receipt */}
                          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            {transferReceipts[transactionKey] ? (
                              <div style={{ position: 'relative' }}>
                                <img
                                  src={transferReceipts[transactionKey]}
                                  alt="Comprobante"
                                  style={{
                                    width: '100%',
                                    maxHeight: '120px',
                                    objectFit: 'cover',
                                    borderRadius: '10px'
                                  }}
                                />
                                <div style={{
                                  position: 'absolute',
                                  top: '8px',
                                  left: '8px',
                                  padding: '4px 10px',
                                  background: 'rgba(74, 222, 128, 0.9)',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  fontWeight: '600',
                                  color: '#000'
                                }}>
                                  ✓ Pagado
                                </div>
                                <button
                                  onClick={() => {
                                    const newReceipts = { ...transferReceipts };
                                    delete newReceipts[transactionKey];
                                    setTransferReceipts(newReceipts);
                                  }}
                                  style={{
                                    position: 'absolute',
                                    top: '8px',
                                    right: '8px',
                                    width: '24px',
                                    height: '24px',
                                    background: 'rgba(0,0,0,0.6)',
                                    border: 'none',
                                    borderRadius: '50%',
                                    color: 'white',
                                    cursor: 'pointer'
                                  }}
                                >×</button>
                              </div>
                            ) : (
                              <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                padding: '12px',
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: '2px dashed rgba(255, 255, 255, 0.15)',
                                borderRadius: '10px',
                                color: 'rgba(255, 255, 255, 0.5)',
                                cursor: 'pointer',
                                fontSize: '13px'
                              }}>
                                📷 Subir comprobante de transferencia
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => handleImageUpload(e, false, transactionKey)}
                                  style={{ display: 'none' }}
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ textAlign: 'center', padding: '32px' }}>
                      <div style={{ fontSize: '40px', marginBottom: '12px' }}>🎉</div>
                      <div style={{ color: 'white', fontWeight: '600' }}>¡Todo equilibrado!</div>
                      <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '13px' }}>
                        No hay movimientos pendientes
                      </div>
                    </div>
                  )}
                </Card>

                {/* Share & Export buttons */}
                <Card>
                  <h3 style={{ color: 'white', fontSize: '16px', margin: '0 0 16px', fontWeight: '600' }}>
                    📤 Compartir
                  </h3>
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                    <Button onClick={shareToWhatsApp} style={{ flex: 1, background: '#25D366' }}>
                      💬 WhatsApp
                    </Button>
                    <Button onClick={shareResults} style={{ flex: 1 }}>
                      📋 Copiar
                    </Button>
                  </div>
                  
                  <h3 style={{ color: 'white', fontSize: '16px', margin: '16px 0 16px', fontWeight: '600' }}>
                    📥 Exportar
                  </h3>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <Button 
                      onClick={() => exportToPDF(participants, expenses, results, eventName)} 
                      style={{ flex: 1, background: 'rgba(220, 38, 38, 0.3)', border: '1px solid rgba(220, 38, 38, 0.5)' }}
                    >
                      📄 PDF
                    </Button>
                    <Button 
                      onClick={() => exportToExcel(participants, expenses, results, eventName)} 
                      style={{ flex: 1, background: 'rgba(34, 197, 94, 0.3)', border: '1px solid rgba(34, 197, 94, 0.5)' }}
                    >
                      📊 Excel
                    </Button>
                  </div>
                </Card>
              </>
            )}
          </>
        )}
      </div>

      {/* Install Banner */}
      {showInstallBanner && installPrompt && (
        <InstallBanner 
          onInstall={handleInstall} 
          onDismiss={() => setShowInstallBanner(false)} 
        />
      )}
    </div>
  );
}
