import React from "react";
import "./StatusBadge.css";

export type StatusBadgeState = "synced" | "pending" | "syncing" | "error";

const DEFAULT_LABELS: Record<StatusBadgeState, string> = {
    synced: "🟢 Synced",
    pending: "🟡 Pending",
    syncing: "🔵 Syncing",
    error: "🔴 Error",
};

export interface StatusBadgeProps {
    /** The 4-state sync badge from js/status-badge.js, injected into #header. */
    state: StatusBadgeState;
    label?: string;
}

export function StatusBadge({ state, label }: StatusBadgeProps) {
    return (
        <span className={`ds-status-badge ds-status-badge--${state}`}>
            {label ?? DEFAULT_LABELS[state]}
        </span>
    );
}
