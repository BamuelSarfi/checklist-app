import React from "react";
import { StatusBadge } from "checklist-kitchen-ds";

export function Synced() {
    return <StatusBadge state="synced" />;
}

export function Pending() {
    return <StatusBadge state="pending" label="3 Records Pending Sync (Offline)" />;
}

export function Syncing() {
    return <StatusBadge state="syncing" />;
}

export function ErrorState() {
    return <StatusBadge state="error" />;
}
