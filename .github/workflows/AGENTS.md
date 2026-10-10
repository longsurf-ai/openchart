# CI

- Every PR and main push runs the four existing workspace check phases and the
  public-content gate. `just check` runs those same application checks locally.
- Tea is the pinned public submodule. CI needs no private repository credentials.
- Actions have read-only repository access. Never run untrusted pull-request
  code with production credentials or use `pull_request_target` for builds.
- Mac releases use the documented signing-Mac commands. The Windows lane builds
  unsigned installers without production credentials; Intel Mac CI exercises
  development packages. Both upload only Actions artifacts. CI does not publish
  updates or deploy separately owned hosted services.
