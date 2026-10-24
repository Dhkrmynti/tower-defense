"use client";
import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ExternalLink,
  Search,
  Copy,
  Check,
} from "lucide-react";
import { ActivityLog, BurnLedgerEntry, FlywheelState, MachineConfig } from "../types";

interface BurnLedgerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  logs: ActivityLog[];
  burnLedger: BurnLedgerEntry[];
  state: FlywheelState;
  config: MachineConfig;
}

interface NormalizedLogItem {
  id: string;
  time: string;
  type: "burn" | "buyback" | "claim" | "trigger" | "system";
  tag: string;
  message: string;
  txHash?: string;
}

export const BurnLedgerDrawer: React.FC<BurnLedgerDrawerProps> = ({
  isOpen,
  onClose,
  logs,
  burnLedger,
  state,
  config,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<"all" | "burn" | "buyback" | "claim">("all");
  const [copied, setCopied] = useState(false);

  const explorerUrl = "https://explorer.mainnet.chain.robinhood.com";

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Normalize all activity logs & burn ledger into clean chronological log lines
  const allLogs: NormalizedLogItem[] = useMemo(() => {
    const items: NormalizedLogItem[] = [];

    // Add burn ledger entries
    if (burnLedger && burnLedger.length > 0) {
      for (const entry of burnLedger) {
        const timeOnly = entry.timeStr ? entry.timeStr.split(" (")[0] : new Date(entry.timestamp).toLocaleTimeString();

        if (entry.cycleType === "keep") {
          items.push({
            id: `claim-${entry.id}`,
            time: timeOnly,
            type: "claim",
            tag: "FEE CLAIM",
            message: entry.claimedETH ? `Garrison pay: ${entry.claimedETH.toFixed(4)} ETH of fees sent to the treasury` : "Garrison pay sent to the treasury",
            txHash: entry.claimTx || "",
          });
        } else {
          const burnedTokens = entry.burnedJollyburn || entry.burnedMuseburn || entry.burnedIncinerator || 0;
          if (burnedTokens > 0 || entry.burnTx) {
            items.push({
              id: `burn-${entry.id}`,
              time: timeOnly,
              type: "burn",
              tag: "BURN",
              message: burnedTokens > 0 ? `Purged ${new Intl.NumberFormat("en-US").format(Math.round(burnedTokens))} $BASTION at 0x000...dEaD` : "Purged $BASTION at 0x000...dEaD",
              txHash: entry.burnTx || entry.claimTx || "",
            });
          }
          if (entry.boughtETH || entry.buyTx) {
            items.push({
              id: `buy-${entry.id}`,
              time: timeOnly,
              type: "buyback",
              tag: "BUYBACK",
              message: entry.boughtETH ? `Bought $BASTION back with ${entry.boughtETH.toFixed(4)} ETH` : "Bought $BASTION back",
              txHash: entry.buyTx || "",
            });
          }
        }
      }
    }

    // Add activity logs
    if (logs && logs.length > 0) {
      for (const log of logs) {
        // avoid exact duplicates by id
        if (!items.some((it) => it.id === log.id || it.id === `burn-${log.id}`)) {
          let type: NormalizedLogItem["type"] = "system";
          let tag = "SYSTEM";
          if (log.phase === "burn") {
            type = "burn";
            tag = "BURN";
          } else if (log.phase === "buyback") {
            type = "buyback";
            tag = "BUYBACK";
          } else if (log.phase === "claim" || log.phase === "keep") {
            type = "claim";
            tag = "CLAIM";
          } else if (log.phase === "accumulate") {
            type = "trigger";
            tag = "TRIGGER";
          }

          items.push({
            id: log.id,
            time: log.timestamp || "00:00:00",
            type,
            tag,
            message: log.details || log.action,
            txHash: log.txHash,
          });
        }
      }
    }

    return items;
  }, [burnLedger, logs]);

  // Filter logs by search and tag
  const filteredLogs = useMemo(() => {
    return allLogs.filter((item) => {
      if (selectedFilter !== "all" && item.type !== selectedFilter) {
        return false;
      }
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        item.message.toLowerCase().includes(term) ||
        item.tag.toLowerCase().includes(term) ||
        (item.txHash ? item.txHash.toLowerCase().includes(term) : false)
      );
    });
  }, [allLogs, selectedFilter, searchTerm]);

  // Copy all visible logs to clipboard
  const handleCopyLogs = () => {
    const text = filteredLogs
      .map((l) => `[${l.time}] [${l.tag}] ${l.message}${l.txHash ? ` (tx: ${l.txHash})` : ""}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getTagColor = (type: NormalizedLogItem["type"]) => {
    switch (type) {
      case "burn":
        return "bg-ring text-night";
      case "buyback":
        return "bg-pen text-paper";
      case "claim":
        return "bg-fuel text-night";
      case "trigger":
        return "border border-pen/40 text-pen";
      default:
        return "border border-pen/20 text-pen-soft";
    }
  };

  const TAG_LABELS: Record<NormalizedLogItem["type"], string> = {
    burn: "purge",
    buyback: "buyback",
    claim: "claim",
    trigger: "war chest",
    system: "warden",
  };

  const FILTER_LABELS: Record<typeof selectedFilter, string> = {
    all: "all",
    burn: "purges",
    buyback: "buybacks",
    claim: "claims",
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.div
            className="absolute inset-0 bg-[#0e0714d9]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="burn-log-title"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 flex h-full w-full max-w-[34rem] flex-col paper font-body text-pen"
          >
            {/* Header */}
                        <div className="flex items-start justify-between gap-4 px-5 pb-5 pt-6 sm:px-7">
              <div>
                <h3 id="burn-log-title" className="m-0 display text-[2.8rem] text-pen">
                  The Battle Log
                </h3>
                <p className="m-0 mt-2 text-[0.98rem] text-pen-soft">
                  Live from Robinhood Chain · {filteredLogs.length} {filteredLogs.length === 1 ? "entry" : "entries"}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close the log"
                title="Close (Esc)"
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-pen/40 text-pen transition-colors hover:border-marker hover:text-marker"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Filters & search */}
            <div className="flex flex-wrap items-center gap-3 border-y border-pen/25 bg-paper/85 px-5 py-3 sm:px-7">
              <div className="flex items-center gap-1" role="tablist" aria-label="Filter entries">
                {(["all", "burn", "buyback", "claim"] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    role="tab"
                    aria-selected={selectedFilter === filter}
                    onClick={() => setSelectedFilter(filter)}
                    className={`cursor-pointer rounded-full px-3 py-1 display text-[0.95rem] transition-colors ${
                      selectedFilter === filter ? "bg-pen text-paper" : "text-pen-soft hover:text-pen"
                    }`}
                  >
                    {FILTER_LABELS[filter]}
                  </button>
                ))}
              </div>

              <div className="ml-auto flex flex-1 items-center gap-2 sm:flex-initial">
                <div className="relative w-full sm:w-40">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-pen-soft" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="search tx"
                    aria-label="Search the log"
                    className="w-full rounded-full border border-pen/30 bg-[#f8f4ea] py-1.5 pl-8 pr-3 font-mono text-[0.82rem] text-pen placeholder:text-pen-soft focus:border-pen focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCopyLogs}
                  title="Copy visible entries"
                  className="btn-pen shrink-0 cursor-pointer bg-paper px-3 py-1 text-[0.92rem]"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "copied" : "copy"}
                </button>
              </div>
            </div>

            {/* Entries */}
            <ol className="m-0 flex-1 list-none overflow-y-auto p-0">
              {filteredLogs.length === 0 ? (
                <li className="px-7 py-16 text-center text-[1.05rem] leading-relaxed text-pen-soft">
                  {allLogs.length === 0 ? (
                    <>
                      <span className="block display text-[1.3rem] text-pen">No rounds yet</span>
                      Every claim, buyback and purge of $BASTION lands here with its transaction, once the CA is live.
                    </>
                  ) : (
                    "Nothing in the log matches. Try “all” or clear the search."
                  )}
                </li>
              ) : (
                filteredLogs.map((item) => (
                  <li key={item.id} className="border-b border-pen/15 px-5 py-3.5 transition-colors hover:bg-[#e6dfcb]/70 sm:px-7">
                    <div className="flex items-center justify-between gap-3">
                      <span className={`rounded-full px-2.5 py-0.5 display text-[0.85rem] ${getTagColor(item.type)}`}>
                        {TAG_LABELS[item.type]}
                      </span>
                      <span className="tabular font-mono text-[0.8rem] text-pen-soft">{item.time}</span>
                    </div>
                    <p className="m-0 mt-1.5 break-words font-mono text-[0.84rem] leading-relaxed text-pen">{item.message}</p>
                    {item.txHash && item.txHash.startsWith("0x") && (
                      <a
                        href={`${explorerUrl}/tx/${item.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 font-mono text-[0.8rem] text-pen underline decoration-pen/40 underline-offset-[3px] hover:text-marker"
                      >
                        {item.txHash.slice(0, 10)}…{item.txHash.slice(-6)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </li>
                ))
              )}
            </ol>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-pen/25 bg-paper/85 px-5 py-4 text-[0.85rem] text-pen-soft sm:px-7">
              <span className="truncate font-mono">Dead address · 0x000...dEaD</span>
              <button type="button" onClick={onClose} className="btn-pen cursor-pointer bg-paper px-4 py-1.5 text-[0.95rem]">
                Close
              </button>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
};
