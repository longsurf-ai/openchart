# api

Public entry point for the v2 chart runtime. Wires a canvas element to the chart state by creating a renderer (owns the paint loop and canvas lifecycle) and binding DOM events that translate user interactions into state mutations.

Read [INVARIANTS.md](INVARIANTS.md) before changing this module. It preserves the
renderer, state, identity, and lifecycle rules that apply here.
