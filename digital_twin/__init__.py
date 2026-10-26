"""TSYP 14 Track 1 digital twin: the ground link from orbit to verdict, in 13 modules.

Phase 1, space environment and protocols: ephemeris_loader, propagation, link_budget,
visibility_calculator, ccsds_framing.
Phase 2, multi-layer security: attack_injector, crypto_hash_verifier,
isolation_forest_detector, security_detector (chi-square and kinematic physics engine).
Phase 3, orchestration and mission control: physics_validator, audit_logger,
api_gateway (FastAPI), dashboard_ui (Streamlit).

The mission is the testbed's: LEO-SAT on a 542.8 km sun-synchronous orbit, an 8477.8 MHz
X-band downlink to the Zaghouan ground station, frames sealed with HMAC-SHA256.
"""
