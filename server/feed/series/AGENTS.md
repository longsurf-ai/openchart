# Series

Finite reads of declared timeseries, such as Workspace Datasets, by id.

- Providers bind runtime declarations with an `adapt` that accepts only their
  own declarations by identity; Feed checks it live, so those declarations
  alter the version as they come and go.
- `select` returns every declared column within `[from, to)`; an id no ready
  source serves fails `Feed.SourceUnavailable`, which covers a Dataset declared
  moments ago. Source failures map through `datasetFailure`.
- tRPC `feed.series.select` encodes the DataFrame with the shared codec.
