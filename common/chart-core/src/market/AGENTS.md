# Core market boundary

OpenChart `@openchart/market` owns provider/listing identity; `@openchart/feed` owns
requests. Never restore InstrumentView or invent required numeric listing IDs.
Core has no datasource/search/calendar service; the app supplies data via Feed.

The retained resolution utilities use core epoch seconds for geometry. Their
cadence vocabulary is derived from OpenChart Feed. Transport/calendar times stay in
milliseconds and are converted only at the app rendering boundary.
