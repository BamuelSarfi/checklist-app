import React, { useState } from "react";
import { PinInput } from "checklist-kitchen-ds";

export function Default() {
    const [value, setValue] = useState("");
    return <PinInput value={value} onChange={setValue} />;
}

export function PartiallyFilled() {
    const [value, setValue] = useState("123");
    return <PinInput value={value} onChange={setValue} />;
}

export function ErrorState() {
    const [value, setValue] = useState("");
    return <PinInput value={value} onChange={setValue} error="Invalid PIN. Please try again." />;
}
