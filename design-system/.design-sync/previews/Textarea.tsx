import React from "react";
import { Textarea } from "checklist-kitchen-ds";

export function Default() {
    return (
        <Textarea
            label="Corrective Action"
            defaultValue="Fridge temperature was 6°C — food discarded, thermostat adjusted, re-checked after 30 minutes."
        />
    );
}

export function ErrorState() {
    return <Textarea label="Corrective Action" error="Required field" />;
}
