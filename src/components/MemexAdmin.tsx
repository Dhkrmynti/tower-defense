import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import {
  Key,
  Coins,
  Eye,
  EyeOff,
  Save,
  Check,
  ArrowLeft,
  ShieldAlert,
  Wallet,
  CheckCircle2,
  RefreshCw,
  Landmark,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { BastionMark } from './bastion/BastionMark';

interface MemexAdminProps {
  onBack?: () => void;
}

export function MemexAdmin({ onBack }: MemexAdminProps) {
  const [privateKey, setPrivateKey] = useState<string>('');
  const [tokenAddress, setTokenAddress] = useState<string>('');
  const [treasuryAddress, setTreasuryAddress] = useState<string>('');
  const [showPrivateKey, setShowPrivateKey] = useState<boolean>(false);
  const [derivedWallet, setDerivedWallet] = useState<string | null>(null);
  const [isTokenValid, setIsTokenValid] = useState<boolean>(false);
  const [isTreasuryValid, setIsTreasuryValid] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  // Operator wallet the bot is currently running with (its key never leaves the server)
  const [botWallet, setBotWallet] = useState<string>('');

  // Load the current config from the bot; nothing is kept in browser storage
  useEffect(() => {
    const loadSavedConfig = async () => {
      let loadedKey = '';
      let loadedToken = '';
      let loadedTreasury = '';

      // 0. Drop values older versions of this page kept in the browser (incl. the private key)
      try {
        ['memex_private_key', 'memex_token_address', 'memex_treasury_address', 'memex_creator_address', 'jollyburn_engine_config'].forEach((k) =>
          localStorage.removeItem(k)
        );
      } catch {}

      // 1. Live bot config (production)
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            if (json.data.tokenAddress) loadedToken = json.data.tokenAddress;
            if (json.data.treasuryAddress) loadedTreasury = json.data.treasuryAddress;
            if (json.data.walletAddress) setBotWallet(json.data.walletAddress);
          }
        }
      } catch {
        // bot might be offline
      }

      // 2. Local dev server (.env / bot-config.json)
      try {
        const res = await fetch('/api/admin/config');
        if (res.ok) {
          const json = await res.json();
          if (json.tokenAddress && !loadedToken) loadedToken = json.tokenAddress;
          if (json.privateKey && !loadedKey) loadedKey = json.privateKey;
          if (json.treasuryAddress && !loadedTreasury) loadedTreasury = json.treasuryAddress;
        }
      } catch (e) {
        // server might not be active
      }

      if (loadedKey) setPrivateKey(loadedKey);
      if (loadedToken) setTokenAddress(loadedToken);
      if (loadedTreasury) setTreasuryAddress(loadedTreasury);
    };

    loadSavedConfig();
  }, []);

  // Validate and derive wallet from private key in real-time
  useEffect(() => {
    const trimmed = privateKey.trim();
    if (!trimmed) {
      setDerivedWallet(null);
      return;
    }

    try {
      const formatted = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
      if (formatted.length === 66) {
        const wallet = new ethers.Wallet(formatted);
        setDerivedWallet(wallet.address);
      } else {
        setDerivedWallet(null);
      }
    } catch {
      setDerivedWallet(null);
    }
  }, [privateKey]);

  // Validate token address
  useEffect(() => {
    const trimmed = tokenAddress.trim().toLowerCase();
    const valid = trimmed.startsWith('0x') && trimmed.length === 42 && ethers.isAddress(trimmed);
    setIsTokenValid(valid);
  }, [tokenAddress]);

  // Validate treasury address (optional)
  useEffect(() => {
    const trimmed = treasuryAddress.trim().toLowerCase();
    if (!trimmed) {
      setIsTreasuryValid(true);
      return;
    }
    const valid = trimmed.startsWith('0x') && trimmed.length === 42 && ethers.isAddress(trimmed);
    setIsTreasuryValid(valid);
  }, [treasuryAddress]);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    setIsSaving(true);
    setSaveStatus('idle');
    setStatusMessage('');

    const cleanToken = tokenAddress.trim();
    const cleanKey = privateKey.trim();
    const cleanTreasury = treasuryAddress.trim();

    try {
      const cleanCreator = derivedWallet || '';
      // An empty key field means "keep the key the bot already has"
      const payload = JSON.stringify({
        tokenAddress: cleanToken,
        privateKey: cleanKey || undefined,
        treasuryAddress: cleanTreasury,
        creatorAddress: cleanCreator || undefined,
      });

      // 1. Local dev server: persist in .env and bot-config.json
      let savedToBackend = false;
      try {
        const res = await fetch('/api/admin/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
        if (res.ok) savedToBackend = true;
      } catch {
        // not running
      }

      // 2. The bot itself (production)
      try {
        const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
        if (res.ok) {
          savedToBackend = true;
          const json = await res.json().catch(() => null);
          if (json?.walletAddress !== undefined) setBotWallet(json.walletAddress || '');
        }
      } catch {
        // bot might be offline
      }

      if (!savedToBackend) {
        throw new Error('the bot is offline, nothing was saved');
      }

      // Every open page re-reads the token from the bot
      window.dispatchEvent(new Event('memex_config_updated'));
      if (cleanKey) setPrivateKey('');

      setSaveStatus('success');
      setStatusMessage('Saved to the bot. Every visitor now sees this token.');

      setTimeout(() => {
        setSaveStatus('idle');
      }, 4000);
    } catch (err: any) {
      setSaveStatus('error');
      setStatusMessage(`Failed to save: ${err.message || 'An error occurred'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetTokenAddress = async () => {
    setTokenAddress('');
    const body = JSON.stringify({ tokenAddress: '' });
    for (const url of ['/api/admin/save', '/api/config']) {
      try {
        await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      } catch {}
    }
    window.dispatchEvent(new Event('memex_config_updated'));
    setStatusMessage('Token contract address has been cleared.');
    setSaveStatus('success');
    setTimeout(() => setSaveStatus('idle'), 3000);
  };

  const handleResetAll = async () => {
    if (!window.confirm('Are you sure you want to reset all addresses and configuration back to blank/defaults?')) {
      return;
    }

    setIsSaving(true);
    setSaveStatus('idle');
    setStatusMessage('');

    try {
      // 1. Clear component state
      setTokenAddress('');
      setPrivateKey('');
      setTreasuryAddress('');
      setDerivedWallet(null);
      setBotWallet('');

      // 2. Remove all storage keys
      try {
        localStorage.removeItem('memex_token_address');
        localStorage.removeItem('memex_private_key');
        localStorage.removeItem('memex_treasury_address');
        localStorage.removeItem('memex_creator_address');
        localStorage.removeItem('jollyburn_engine_config');
        localStorage.removeItem('jollyburn_activity_logs');
        localStorage.removeItem('jollyburn_burn_ledger');
        localStorage.removeItem('museburn_engine_config');
        localStorage.removeItem('museburn_activity_logs');
        localStorage.removeItem('museburn_burn_ledger');
        localStorage.removeItem('incinerator_engine_config');
        localStorage.removeItem('incinerator_activity_logs');
        localStorage.removeItem('incinerator_burn_ledger');
      } catch {}

      // 3. Dispatch real-time sync event
      window.dispatchEvent(new Event('memex_config_updated'));

      // 4. Reset backend .env and bot-config.json if server is running
      try {
        await fetch('/api/admin/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenAddress: '',
            privateKey: '',
            treasuryAddress: '',
            creatorAddress: ''
          })
        });
      } catch {}

      try {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenAddress: '',
            privateKey: '',
            treasuryAddress: '',
            creatorAddress: ''
          })
        });
      } catch {}

      setSaveStatus('success');
      setStatusMessage('All addresses and configuration have been reset to blank defaults.');
      setTimeout(() => {
        setSaveStatus('idle');
      }, 4000);
    } catch (err: any) {
      setSaveStatus('error');
      setStatusMessage(`Failed to reset: ${err.message || 'An error occurred'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const navigateToDashboard = () => {
    if (onBack) {
      onBack();
    } else {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const inputClass =
    'w-full bg-soot border border-bark focus:border-ember focus:ring-1 focus:ring-ember rounded-lg px-4 py-3 text-sm font-mono text-hot placeholder-ash outline-none transition-colors';
  const labelClass =
    'text-xs sm:text-sm font-display font-bold uppercase tracking-[0.12em] text-plaque flex items-center gap-2';
  const validBadge = 'text-[11px] font-mono text-flame flex items-center gap-1 font-semibold';
  const hintClass = 'text-[11px] text-ash-light';
  const warnClass = 'text-[11px] text-ember font-mono';

  return (
    <div className="min-h-screen bg-soot text-[#f1e7d6] font-body flex flex-col">
      {/* Header */}
      <header className="h-16 px-4 sm:px-8 md:px-12 flex items-center justify-between border-b border-wood bg-soot/85 sticky top-0 z-40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={navigateToDashboard}
            className="flex items-center gap-2 text-ash-light hover:text-hot transition-colors cursor-pointer text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back to the arena</span>
          </button>
          <div className="h-4 w-[1px] bg-bark" />
          <div className="flex items-center gap-2">
            <BastionMark className="h-7 w-7" />
            <span className="font-sign font-black uppercase text-hot text-2xl leading-none">
              Bastion
            </span>
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-char text-flame border border-bark font-semibold">
              Warden
            </span>
          </div>
        </div>
      </header>

      {/* Main Admin Form */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 md:p-8">
        <div className="max-w-xl w-full">
          <div className="bg-char border border-wood rounded-2xl p-6 sm:p-8 relative overflow-hidden">
            {/* Lantern glow */}
            <div className="absolute -top-24 -right-24 w-72 h-72 bg-ember/15 rounded-full blur-3xl pointer-events-none" />

            {/* Header Content */}
            <div className="mb-6 relative z-10">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-soot border border-bark text-xs font-mono text-ash-light mb-3">
                <span className="w-2 h-2 rounded-full bg-ember" />
                The Warden's console
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-black uppercase tracking-[0.04em] text-hot m-0">
                Arm the fortress
              </h1>
              <p className="text-xs sm:text-sm text-ash-light mt-1.5 leading-relaxed">
                Set the Warden's key and the token it defends. Every round runs from what you save here.
              </p>
            </div>

            <form onSubmit={handleSave} className="space-y-6 relative z-10">
              {/* Field 1: Private Key */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className={labelClass}>
                    <Key className="w-4 h-4 text-ember" />
                    Private Key
                  </label>
                  {derivedWallet && (
                    <span className={validBadge}>
                      <CheckCircle2 className="w-3 h-3" />
                      Valid Key
                    </span>
                  )}
                </div>

                <div className="relative">
                  <input
                    type={showPrivateKey ? 'text' : 'password'}
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder="Enter keeper private key (0x...)"
                    className={`${inputClass} pr-11`}
                    autoComplete="off"
                    spellCheck="false"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPrivateKey(!showPrivateKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ash hover:text-hot transition-colors p-1"
                    title={showPrivateKey ? 'Hide' : 'Show'}
                  >
                    {showPrivateKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {/* Derived Wallet Address Display */}
                {derivedWallet ? (
                  <div className="bg-soot border border-bark rounded-lg p-2.5 flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-flame shrink-0" />
                    <div className="text-[11px] font-mono truncate">
                      <span className="text-ash">Address: </span>
                      <span className="text-flame font-semibold">{derivedWallet}</span>
                    </div>
                  </div>
                ) : privateKey.trim().length > 0 ? (
                  <p className={warnClass}>
                    Invalid private key format (must be 64 hex characters).
                  </p>
                ) : botWallet ? (
                  <p className={hintClass}>
                    The bot is running with wallet <span className="font-mono text-flame">{botWallet}</span>. Leave blank to keep it.
                  </p>
                ) : (
                  <p className={hintClass}>
                    Sent straight to the bot on the server. It is never stored in this browser.
                  </p>
                )}
              </div>

              {/* Field 2: Token Address */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className={labelClass}>
                    <Coins className="w-4 h-4 text-ember" />
                    Token Address
                  </label>
                  <div className="flex items-center gap-2">
                    {tokenAddress.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={handleResetTokenAddress}
                        className="text-[11px] font-mono text-ash-light hover:text-ember hover:underline flex items-center gap-1 cursor-pointer transition-colors"
                        title="Clear Token Address"
                      >
                        <Trash2 className="w-3 h-3" />
                        Clear Address
                      </button>
                    )}
                    {isTokenValid && (
                      <span className={validBadge}>
                        <CheckCircle2 className="w-3 h-3" />
                        Valid Address
                      </span>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <input
                    type="text"
                    value={tokenAddress}
                    onChange={(e) => setTokenAddress(e.target.value)}
                    placeholder="0x... (Token contract address)"
                    className={inputClass}
                    autoComplete="off"
                    spellCheck="false"
                  />
                </div>

                {tokenAddress.trim().length > 0 && !isTokenValid ? (
                  <p className={warnClass}>
                    Must be a valid 42-character EVM address (starting with 0x).
                  </p>
                ) : (
                  <p className={hintClass}>
                    The token the Warden buys back and sends to 0x…dEaD after every round.
                  </p>
                )}
              </div>

              {/* Field 3: Treasury Address (Optional for KEEP Cycles) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className={labelClass}>
                    <Landmark className="w-4 h-4 text-ember" />
                    Treasury / Keep Address
                    <span className="text-[10px] text-ash font-body font-normal normal-case tracking-normal">(Optional)</span>
                  </label>
                  {treasuryAddress.trim() && isTreasuryValid && (
                    <span className={validBadge}>
                      <CheckCircle2 className="w-3 h-3" />
                      Valid Address
                    </span>
                  )}
                </div>

                <div className="relative">
                  <input
                    type="text"
                    value={treasuryAddress}
                    onChange={(e) => setTreasuryAddress(e.target.value)}
                    placeholder="0x... (Creator / Treasury fee recipient wallet)"
                    className={inputClass}
                    autoComplete="off"
                    spellCheck="false"
                  />
                </div>

                {treasuryAddress.trim().length > 0 && !isTreasuryValid ? (
                  <p className={warnClass}>
                    Must be a valid 42-character EVM address (starting with 0x).
                  </p>
                ) : (
                  <p className={hintClass}>
                    Recipient address for ETH during Even (Fee Claim) cycles. If left empty, fees remain securely in the operator wallet.
                  </p>
                )}
              </div>

              {/* Status Message */}
              {statusMessage && (
                <div
                  className={`p-3 rounded-lg border text-xs font-mono flex items-start gap-2 ${
                    saveStatus === 'success'
                      ? 'bg-soot border-flame/40 text-flame'
                      : 'bg-soot border-red-500/50 text-red-300'
                  }`}
                >
                  {saveStatus === 'success' ? (
                    <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{statusMessage}</span>
                </div>
              )}

              {/* Action Buttons: Save Configuration & Reset All */}
              <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full sm:flex-1 py-3.5 px-5 rounded-lg bg-ember hover:bg-flame text-soot font-display font-black uppercase tracking-[0.1em] text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Configuration
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleResetAll}
                  disabled={isSaving}
                  className="w-full sm:w-auto py-3.5 px-5 rounded-lg bg-transparent hover:bg-red-500/10 text-red-300 border border-red-500/40 hover:border-red-400 font-display font-bold uppercase tracking-[0.1em] text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
                  title="Reset all addresses and configuration back to blank defaults"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Reset All</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
export default MemexAdmin;
