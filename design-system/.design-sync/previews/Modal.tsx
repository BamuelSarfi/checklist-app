import React from "react";
import { Modal } from "checklist-kitchen-ds";

export function Success() {
    return (
        <Modal
            open
            type="success"
            message="Saved locally. Will sync automatically when online."
            onOk={() => {}}
        />
    );
}

export function ErrorState() {
    return (
        <Modal
            open
            type="error"
            message="Error saving form: network request failed"
            onOk={() => {}}
        />
    );
}

export function Info() {
    return (
        <Modal
            open
            type="info"
            message="Maximum of 16 records allowed"
            onOk={() => {}}
        />
    );
}
