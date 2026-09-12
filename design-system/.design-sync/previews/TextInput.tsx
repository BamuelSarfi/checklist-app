import React from "react";
import { TextInput } from "checklist-kitchen-ds";

export function Default() {
    return <TextInput label="Food Item" defaultValue="Chicken breast" />;
}

export function Temperature() {
    return <TextInput label="Temperature (°C)" type="number" defaultValue="4.2" />;
}

export function ErrorState() {
    return <TextInput label="Food Item" error="Required field" />;
}
