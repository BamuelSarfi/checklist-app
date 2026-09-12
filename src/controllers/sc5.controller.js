const e = require('express');
const fillSc5 = require('../lib/fillSc5');
const path = require('path');
const fs = require('fs');
const generatedRecords = require('../services/generatedRecords');

exports.showForm = (req, res) => {
  res.sendFile(path.join(__dirname, '../views/sc5.html'));
};

exports.getTodayStatus = async (req, res) => {
  try {
    const todayIso = new Date().toISOString().slice(0, 10);
    const typesToday = await generatedRecords.listRecordTypesForDate(todayIso);

    res.json({
      success: true,
      completed: typesToday.includes('SC5'),
    });
  } catch (err) {
    console.error('Error checking SC5 status:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.processForm = async (req, res) => {
  try {
    // console.log('Received data:', req.body);

    // SC5 is a once-per-day checklist - reject a second submission rather than silently
    // generating a duplicate PDF/record for the same day.
    const todayIso = new Date().toISOString().slice(0, 10);
    const typesToday = await generatedRecords.listRecordTypesForDate(todayIso);
    if (typesToday.includes('SC5')) {
      return res.status(409).json({
        success: false,
        already_completed: true,
        message: 'SC5 has already been completed today.',
      });
    }

    // Identity comes from the authenticated session, never from the request body - see
    // sc1.controller.js for the failure this prevents (any authenticated kiosk session could
    // otherwise submit a form attributed to a different or entirely fabricated employee).
    const employee = req.employee;
    if (!employee) {
      return res.status(401).json({ success: false, message: 'Employee not identified' });
    }

    req.body.employee_id = employee.id;
    req.body.name = employee.name;
    req.body.position = employee.role || employee.preferred_language || 'Employee';

    const { fileName, syncStatus, syncMessage } = await fillSc5(req.body);

    res.json({
      success: true,
      file: fileName,
      // Non-blocking: the form above already saved successfully. This just tells the
      // manager the record hasn't synced to SafeCater yet (e.g. inactive subscription).
      sync_warning: syncStatus === 'subscription_inactive' ? syncMessage : null,
    });

  } catch (err) {
    // 23505 = Postgres unique_violation - the fast pre-check above raced with another
    // request and lost to idx_generated_records_sc5_once_daily (the authoritative guard).
    // Same friendly response as the normal "already completed" path, not a 500.
    if (err.code === '23505') {
      return res.status(409).json({
        success: false,
        already_completed: true,
        message: 'SC5 has already been completed today.',
      });
    }

    console.error(err);

    res.status(500).json({
      success: false,
      error: JSON.stringify(err)
    });
  }

};