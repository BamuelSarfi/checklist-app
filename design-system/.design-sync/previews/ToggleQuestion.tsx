import React, { useState } from "react";
import { ToggleQuestion } from "checklist-kitchen-ds";

export function Unchecked() {
    const [checked, setChecked] = useState(false);
    return <ToggleQuestion question="Checked use-by date and condition" checked={checked} onToggle={setChecked} />;
}

export function Checked() {
    const [checked, setChecked] = useState(true);
    return <ToggleQuestion question="Checked use-by date and condition" checked={checked} onToggle={setChecked} />;
}
