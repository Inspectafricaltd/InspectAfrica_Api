-- Migration: 0005_condition_subsection.sql
-- Adds subsection grouping for ACHI defect library conditions.
-- The 34 subsections are derived from each condition's slug prefix.

ALTER TABLE "master_conditions" ADD COLUMN IF NOT EXISTS "subsection" text;

UPDATE master_conditions SET subsection = CASE
  -- Site & Externals
  WHEN slug LIKE 'ext_site_%' THEN 'Site & Drainage'
  WHEN slug LIKE 'ext_fen_%'  THEN 'Fencing & Boundary'
  WHEN slug LIKE 'ext_bld_%'  THEN 'External Walls'
  WHEN slug LIKE 'ext_drv_%'  THEN 'Driveway & Carpark'
  WHEN slug LIKE 'ext_lnd_%'  THEN 'Landscaping'
  WHEN slug LIKE 'ext_srv_%'  THEN 'External Services'
  -- Structure
  WHEN slug LIKE 'str_fnd_%'  THEN 'Foundation'
  WHEN slug LIKE 'str_frm_%'  THEN 'Structural Frame'
  -- Roofing
  WHEN slug LIKE 'rf_dr_%'    THEN 'Roof Drainage'
  WHEN slug LIKE 'rf_rsc_%'   THEN 'Roof Structure & Covering'
  WHEN slug LIKE 'rf_rsv_%'   THEN 'Roof Water Tanks'
  WHEN slug LIKE 'rf_tp_%'    THEN 'Parapets & Roof Tops'
  WHEN slug LIKE 'rf_wp_%'    THEN 'Waterproofing & Flashings'
  -- Electrical
  WHEN slug LIKE 'elec_ap_%'  THEN 'Alternative Power'
  WHEN slug LIKE 'elec_dp_%'  THEN 'Distribution & Panel'
  WHEN slug LIKE 'elec_fix_%' THEN 'Fixtures & Outlets'
  WHEN slug LIKE 'elec_wir_%' THEN 'Wiring'
  -- Plumbing
  WHEN slug LIKE 'plmb_dw_%'  THEN 'Drainage & Waste'
  WHEN slug LIKE 'plmb_fix_%' THEN 'Fixtures'
  WHEN slug LIKE 'plmb_sto_%' THEN 'Water Storage'
  WHEN slug LIKE 'plmb_ws_%'  THEN 'Water Supply'
  -- HVAC
  WHEN slug LIKE 'hvac_cl_%'   THEN 'Cooling'
  WHEN slug LIKE 'hvac_inst_%' THEN 'Installation'
  WHEN slug LIKE 'hvac_vnt_%'  THEN 'Ventilation'
  WHEN slug LIKE 'hvac_wh_%'   THEN 'Water Heating'
  -- Life Safety
  WHEN slug LIKE 'safe_acc_%'  THEN 'Access & Falls'
  WHEN slug LIKE 'safe_egr_%'  THEN 'Egress & Exits'
  WHEN slug LIKE 'safe_fir_%'  THEN 'Fire Safety'
  WHEN slug LIKE 'safe_gas_%'  THEN 'Gas & Carbon Monoxide'
  -- Interiors
  WHEN slug LIKE 'int_fin_%'   THEN 'Finishes'
  WHEN slug LIKE 'int_ftr_%'   THEN 'Fixtures & Fittings'
  WHEN slug LIKE 'int_moi_%'   THEN 'Moisture & Dampness'
  WHEN slug LIKE 'int_opn_%'   THEN 'Doors & Windows'
  WHEN slug LIKE 'int_wet_%'   THEN 'Wet Areas'
  ELSE NULL
END;
