import './App.css';
import { useState } from 'react';

const API = process.env.REACT_APP_API_BASE_URL
  ? `${process.env.REACT_APP_API_BASE_URL}/airline`
  : '/airline';

function App() {
  const [step, setStep] = useState('validate'); // 'validate' | 'confirm' | 'done'
  const [pnr, setPnr] = useState('');
  const [orderData, setOrderData] = useState(null);
  const [remark, setRemark] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleValidate = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API}/validatePNR`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderid: pnr }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message || 'Validation failed');
      } else {
        setOrderData(json.data);
        setStep('confirm');
      }
    } catch {
      setError('Failed to reach server');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderid: pnr,
          beneficiaryAcno: orderData?.beneficiaryAcno || '',
          remark,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.status === 'Error') {
        setError(json.message || 'Confirmation failed');
      } else {
        setResult(json);
        setStep('done');
      }
    } catch {
      setError('Failed to reach server');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep('validate');
    setPnr('');
    setOrderData(null);
    setRemark('');
    setResult(null);
    setError(null);
  };

  return (
    <div className="App">
      <h1>Enat Bank — Airline Ticketing</h1>
      <div className="App-header">

        {step === 'validate' && (
          <form onSubmit={handleValidate}>
            <label>
              PNR / Order ID
              <input
                type="text"
                value={pnr}
                onChange={e => setPnr(e.target.value)}
                placeholder="Enter PNR"
                required
              />
            </label>
            <input type="submit" value={loading ? 'Validating...' : 'Validate'} disabled={loading} />
          </form>
        )}

        {step === 'confirm' && orderData && (
          <form onSubmit={handleConfirm}>
            <label>
              Order ID
              <input type="text" value={pnr} readOnly />
            </label>
            <label>
              Customer Name
              <input type="text" value={orderData.customerName || ''} readOnly />
            </label>
            <label>
              Amount (ETB)
              <input type="text" value={orderData.amount?.toString() || ''} readOnly />
            </label>
            <label>
              Remark
              <input
                type="text"
                value={remark}
                onChange={e => setRemark(e.target.value)}
                placeholder="Optional remark"
              />
            </label>
            <input type="submit" value={loading ? 'Processing...' : 'Confirm Payment'} disabled={loading} />
            <button type="button" onClick={reset} style={{ marginTop: 8, background: '#999' }}>
              Cancel
            </button>
          </form>
        )}

        {step === 'done' && result && (
          <div>
            <p style={{ color: 'green', fontWeight: 'bold' }}>Payment Successful</p>
            <p>Reference: {result.reference}</p>
            <pre>{JSON.stringify(result.rawData, null, 2)}</pre>
            <button type="button" onClick={reset}>New Transaction</button>
          </div>
        )}

        {error && <p style={{ color: 'red', marginTop: 12 }}>{error}</p>}

      </div>
    </div>
  );
}

export default App;