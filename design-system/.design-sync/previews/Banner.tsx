import React from "react";
import { Banner } from "checklist-kitchen-ds";

export function Warning() {
    return <Banner variant="warning">3 records pending sync (offline)</Banner>;
}

export function ErrorState() {
    return (
        <Banner variant="error" onDismiss={() => {}}>
            Failed to sync 2 records — tap to retry
        </Banner>
    );
}

export function Info() {
    return <Banner variant="info">Temperatures must be recorded within 30 minutes of cooking.</Banner>;
}
