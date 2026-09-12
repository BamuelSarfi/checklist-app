import React from "react";
import { Button } from "checklist-kitchen-ds";

export function Default() {
    return <Button>Back</Button>;
}

export function Primary() {
    return (
        <Button variant="primary" fullWidth>
            + Add Record
        </Button>
    );
}

export function Danger() {
    return <Button variant="danger">Logout</Button>;
}

export function Loading() {
    return (
        <Button variant="primary" loading>
            Saving
        </Button>
    );
}

export function IconOnly() {
    return <Button variant="icon" aria-label="Back" icon={<span aria-hidden="true">←</span>} />;
}

export function Disabled() {
    return (
        <Button variant="primary" disabled>
            Add Record
        </Button>
    );
}
