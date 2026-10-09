// Purpose: Generated ordered registry for every V2 SQLite migration.

import type { DatabaseMigration } from "./migration";

export const migrations = [
  {
    ...(await import("./migration/20260904190853_agent-run")).default,
    filename: "20260904190853_agent-run.ts",
    checksum:
      "a22606e822441952306fc4213ca0957a0fa27ed764cb0aa0798fe2f6a61e3342",
  },
  {
    ...(await import("./migration/20260905180427_dashboard")).default,
    filename: "20260905180427_dashboard.ts",
    checksum:
      "218d4ed0f09805deed62f232dc3e1f2a65883737600d8be0fce22358dad522d5",
  },
  {
    ...(await import("./migration/20260905185237_dashboard_tables")).default,
    filename: "20260905185237_dashboard_tables.ts",
    checksum:
      "052e4922782c681c5f3bb6322b09e4c22874eafae4e2b2b95484d09415a0107c",
  },
  {
    ...(await import("./migration/20260905190404_resource_timestamps")).default,
    filename: "20260905190404_resource_timestamps.ts",
    checksum:
      "13d3a1e341565f0ce03c46d86060ba50ff41c7d0a13410f0633727e49c13912e",
  },
  {
    ...(await import("./migration/20260905230717_chart-grid")).default,
    filename: "20260905230717_chart-grid.ts",
    checksum:
      "ee6405cea5f2e178c60d5f346089bdd98d8303a39533d8b33b2ff7ded0d8d22d",
  },
  {
    ...(await import("./migration/20260906005122_tea-script")).default,
    filename: "20260906005122_tea-script.ts",
    checksum:
      "bad812d3d3b2975169617fac1ecd5160b0908cdcf75d2f28306b2c907dca060b",
  },
  {
    ...(await import("./migration/20260907070529_agent-data")).default,
    filename: "20260907070529_agent-data.ts",
    checksum:
      "bfedb36090c8d12115d380726e6622360965b9838e1188f9572302a1f6db04cd",
  },
  {
    ...(await import("./migration/20260907073234_occurrence-resource")).default,
    filename: "20260907073234_occurrence-resource.ts",
    checksum:
      "a1ff11990f021eb1d6f6af4196e9947f1bdc03ade73432151e7f6c33f07c31ec",
  },
  {
    ...(await import("./migration/20260907175025_remove-agent-skills")).default,
    filename: "20260907175025_remove-agent-skills.ts",
    checksum:
      "706a731a2c471b42b857ba121c86e3b7bc3d92ed304a73ed2b6320b1959cf857",
  },
  {
    ...(await import("./migration/20260907183917_simplify-agent-binding"))
      .default,
    filename: "20260907183917_simplify-agent-binding.ts",
    checksum:
      "858bd49aedb9c6fd3560ce79ae1c42fe210aa9eee415c78b3b6be70b2ba5eed2",
  },
  {
    ...(await import("./migration/20260907185415_remove-tool-display-data"))
      .default,
    filename: "20260907185415_remove-tool-display-data.ts",
    checksum:
      "9671c85cece549500cfd99a6ef3b0adde8cfdfcce73a9c88d9a27b1b9a8242e6",
  },
  {
    ...(await import("./migration/20260907190439_remove-assistant-mode"))
      .default,
    filename: "20260907190439_remove-assistant-mode.ts",
    checksum:
      "db9d6cd06ec12908e9b0a60ad1b5198945e158e9b80a4bae8a6dd87f8cc2b818",
  },
  {
    ...(await import("./migration/20260907190920_simplify-context-parts"))
      .default,
    filename: "20260907190920_simplify-context-parts.ts",
    checksum:
      "768576cead5db090bcdb4d0bee79379af0eb3d8732c6a39a063870893ed3c64c",
  },
  {
    ...(await import("./migration/20260907191229_rename-assistant-trigger"))
      .default,
    filename: "20260907191229_rename-assistant-trigger.ts",
    checksum:
      "a0601c998bd293047f89f40c0fff2669e4cec915f27c670123ef1fae696ba132",
  },
  {
    ...(await import("./migration/20260907191744_simplify-session-anchors"))
      .default,
    filename: "20260907191744_simplify-session-anchors.ts",
    checksum:
      "6680b855dbdd90bb8805fc3fcedf9fb542745c52d5bfa8bc1f2021f6bfe7a40a",
  },
  {
    ...(await import("./migration/20260907192917_remove-patch-parts")).default,
    filename: "20260907192917_remove-patch-parts.ts",
    checksum:
      "7368d31251b3e9561aa25c2b3ba8b17984daec4adf123d27b301f03fd9d4061d",
  },
  {
    ...(await import("./migration/20260907195014_merge-quote-dig-in-context"))
      .default,
    filename: "20260907195014_merge-quote-dig-in-context.ts",
    checksum:
      "25f5410423e7ed6a4b33ff912f5dd7f1890b2fd076146b1837c3ed9de387c978",
  },
  {
    ...(await import("./migration/20260907202209_remove-session-user")).default,
    filename: "20260907202209_remove-session-user.ts",
    checksum:
      "352442ad1787859e3d28af9b6801212ad445ff7f2b66a72987e7e55b60a33cb1",
  },
  {
    ...(
      await import("./migration/20260907204003_remove-binding-rotation-intent")
    ).default,
    filename: "20260907204003_remove-binding-rotation-intent.ts",
    checksum:
      "ea6fca97fa86cca4d7f0bcc5f80679a34ce25b8edb739212446a27e3791e5925",
  },
  {
    ...(await import("./migration/20260907204921_remove-binding-superseded-at"))
      .default,
    filename: "20260907204921_remove-binding-superseded-at.ts",
    checksum:
      "f16e1eb317ba6dfe3e987a18ffe4c07b88af84a2dee1a72ab2607b7dc999fb14",
  },
  {
    ...(await import("./migration/20260907210224_remove-binding-generation"))
      .default,
    filename: "20260907210224_remove-binding-generation.ts",
    checksum:
      "9d89a081cb096def9b6adc3f6584dcc5cb42d40a3d3ee9c2aafbda768808db82",
  },
  {
    ...(await import("./migration/20260907210439_remove-part-run")).default,
    filename: "20260907210439_remove-part-run.ts",
    checksum:
      "2af471163f6de8137e6628245f91bebeafd1f48c60ce899f6847df95d3b32216",
  },
  {
    ...(await import("./migration/20260907210446_agent-run-session-fk"))
      .default,
    filename: "20260907210446_agent-run-session-fk.ts",
    checksum:
      "76bb789510e696b0213483ca29c932d26b2ff45e30e76963b334b4d2500b5e09",
  },
  {
    ...(await import("./migration/20260907210622_remove-message-origin"))
      .default,
    filename: "20260907210622_remove-message-origin.ts",
    checksum:
      "ebfe42cbdec479a6c32af632579de4becd29da48e335479cb12ad6fac77c5155",
  },
  {
    ...(
      await import("./migration/20260907211310_remove-occurrence-accepted-at")
    ).default,
    filename: "20260907211310_remove-occurrence-accepted-at.ts",
    checksum:
      "d8545b808864c02858d7394989aafa69441bca9e2560f4ca8ef154b0f18cf7aa",
  },
  {
    ...(await import("./migration/20260907222714_remove-part-session")).default,
    filename: "20260907222714_remove-part-session.ts",
    checksum:
      "c3f7aae993c77bfce4023fc69bd9bd2a759b2a655b230d398468f84379a219ae",
  },
  {
    ...(await import("./migration/20260909011501_permission-grants")).default,
    filename: "20260909011501_permission-grants.ts",
    checksum:
      "b3e6e6a925deb03a415fe294c667d369071eb3918ebf8470d33c17e7bbdcb21b",
  },
  {
    ...(await import("./migration/20260909024543_remove-permission-grants"))
      .default,
    filename: "20260909024543_remove-permission-grants.ts",
    checksum:
      "6e67bd3216f718a8d8ee8f467e19bbbcf67b8579bd2376f965e86c2fcc03a25b",
  },
  {
    ...(await import("./migration/20260909052543_restore-permission-grants"))
      .default,
    filename: "20260909052543_restore-permission-grants.ts",
    checksum:
      "d96c661769dbd8b806eb9d8c228dd877ac55424a6a26aa54cb50a0cc5f56c285",
  },
  {
    ...(await import("./migration/20260909173026_remove-session-permission"))
      .default,
    filename: "20260909173026_remove-session-permission.ts",
    checksum:
      "ee586760b5c42938419ad29be71b6accc2082b788b3f03cdfb3547a3e47fb78f",
  },
  {
    ...(
      await import("./migration/20260909173537_rename-tool-provider-metadata")
    ).default,
    filename: "20260909173537_rename-tool-provider-metadata.ts",
    checksum:
      "c8bd492bb93f831bf0e1b7516b987135fa34e1ed1c648f1639b0e4168ece5f47",
  },
  {
    ...(await import("./migration/20260909180043_remove-pending-tool-raw"))
      .default,
    filename: "20260909180043_remove-pending-tool-raw.ts",
    checksum:
      "11b2c02fb921496b9f94adb4f47b9a036e8503e614488dfa59706260aa61d80d",
  },
  {
    ...(await import("./migration/20260910002225_remove-schedule-user"))
      .default,
    filename: "20260910002225_remove-schedule-user.ts",
    checksum:
      "8ea54845519f2b2676181a5cf2f9b8e9f9809fbdc76c9473ffb2a8c39cb96f54",
  },
  {
    ...(await import("./migration/20260910004036_schedule-hard-delete"))
      .default,
    filename: "20260910004036_schedule-hard-delete.ts",
    checksum:
      "b66a7a50d36ec79fa4a1f473ea27d1ba6ea82fb31baaebd19013864eb517a057",
  },
  {
    ...(await import("./migration/20260910182114_remove-text-visibility-flags"))
      .default,
    filename: "20260910182114_remove-text-visibility-flags.ts",
    checksum:
      "7f299075b93ce898c1ca442dec0ed025a920b0114711dfc9c753436257e9976c",
  },
  {
    ...(await import("./migration/20260911232652_credential")).default,
    filename: "20260911232652_credential.ts",
    checksum:
      "6b8c5c48e7ad30bc896204f1d32064a1870804cdf02cc7b3d489d849619b9eab",
  },
  {
    ...(await import("./migration/20260912183451_merge-plugin-context"))
      .default,
    filename: "20260912183451_merge-plugin-context.ts",
    checksum:
      "2d62f23597cced7d0f9237205ec2cfceba2535cef3139ec6ff88098f5046f839",
  },
  {
    ...(await import("./migration/20260912204736_plugin-context-hook")).default,
    filename: "20260912204736_plugin-context-hook.ts",
    checksum:
      "5bc2377ccea455f074b4f443f9dcdc74c53418b0f09053d468d2366b884e58e7",
  },
  {
    ...(await import("./migration/20260913041915_credential-owner")).default,
    filename: "20260913041915_credential-owner.ts",
    checksum:
      "8fdf17ae03edb5035a1bf3e9ec43a7dc9d6274106fc8e6dd3953f650754c5761",
  },
  {
    ...(await import("./migration/20260913061609_credential-integration"))
      .default,
    filename: "20260913061609_credential-integration.ts",
    checksum:
      "a5a4d8c14514aff8381b490eabedea5737e74a629d4429041d514493e223fdb4",
  },
  {
    ...(await import("./migration/20260913073313_credential-encryption"))
      .default,
    filename: "20260913073313_credential-encryption.ts",
    checksum:
      "5ec60dc5de182ac358ef015b0d684f05119c488d31df3b3f96e04d0eb4510810",
  },
  {
    ...(await import("./migration/20260915230711_credential-active")).default,
    filename: "20260915230711_credential-active.ts",
    checksum:
      "caa7dafa7259292fdcb9bda1774475cded0ea5eb77b77241695a4c01da5f15db",
  },
  {
    ...(await import("./migration/20260916223704_agent-run-stop")).default,
    filename: "20260916223704_agent-run-stop.ts",
    checksum:
      "8736103f271a59e6f4e871e47d71c3409dea2fffce79272e886beb732e860ebb",
  },
  {
    ...(await import("./migration/20260917014159_workspace")).default,
    filename: "20260917014159_workspace.ts",
    checksum:
      "e418c6c25f95250aa715238a001b80f220c083be57e2f5b09983121eb2e84858",
  },
  {
    ...(await import("./migration/20260917065127_chart-provider-listings"))
      .default,
    filename: "20260917065127_chart-provider-listings.ts",
    checksum:
      "4848938e02ad3e2216276dace07595dc48dedd16b46d18d0128e11e964d26e25",
  },
  {
    ...(await import("./migration/20260917065128_chart-session-coverage"))
      .default,
    filename: "20260917065128_chart-session-coverage.ts",
    checksum:
      "f65a6215936d170e3ddd9a40538ca98547e57bb02b2c2a56ba3ebc64c58148fb",
  },
  {
    ...(await import("./migration/20260917065129_drawing_resource")).default,
    filename: "20260917065129_drawing_resource.ts",
    checksum:
      "70fdbf6602a2a8879e5a6421670758437f0e98bf29a0d2fe085584bbb92db2fb",
  },
  {
    ...(await import("./migration/20260917065130_widget-layout")).default,
    filename: "20260917065130_widget-layout.ts",
    checksum:
      "914e8849d3bb27fd908551a32a07e2088f585df8358e61957dee23fc3021e8a6",
  },
  {
    ...(await import("./migration/20260917172942_session-kind-chat")).default,
    filename: "20260917172942_session-kind-chat.ts",
    checksum:
      "8b0e62b075cb858b836007e6bedc92280f2bdcaefb16743afa134066bc0e92fd",
  },
  {
    ...(
      await import("./migration/20260917184400_remove-dig-in-creation-intent")
    ).default,
    filename: "20260917184400_remove-dig-in-creation-intent.ts",
    checksum:
      "4a303eaab304c7d8f7afdb9049f5ccb095d501db971f1c2b62334f6bf18e9543",
  },
  {
    ...(await import("./migration/20260918053502_user-message-workspace"))
      .default,
    filename: "20260918053502_user-message-workspace.ts",
    checksum:
      "c1c3b2cd9841a38ab80a29c6764ad8354668769a7fbc19159819ae37186d79d8",
  },
  {
    ...(
      await import("./migration/20260918061811_optional-user-message-workspace")
    ).default,
    filename: "20260918061811_optional-user-message-workspace.ts",
    checksum:
      "113701c7600238e9f3cf2b3a1a2abab0e7b18a6119436491b78f7c70deba5f57",
  },
  {
    ...(await import("./migration/20260918214003_tool-child-session-links"))
      .default,
    filename: "20260918214003_tool-child-session-links.ts",
    checksum:
      "7c26a808ff61dcd3bcf86d0af8978619bf6713c2f7056110c43d17ff461b923c",
  },
  {
    ...(await import("./migration/20260920043340_remove-quote-source")).default,
    filename: "20260920043340_remove-quote-source.ts",
    checksum:
      "87e5dbc1d27c77aee48233a00bb9ec550639b5bc4d35e1abca0d47564433d258",
  },
  {
    ...(await import("./migration/20260921025826_chart-indicators")).default,
    filename: "20260921025826_chart-indicators.ts",
    checksum:
      "a215325f75a9b314171b6ae21c62489701694b68a929f35835ba03970857ca07",
  },
  {
    ...(await import("./migration/20260921183115_chart-explain-session-kind"))
      .default,
    filename: "20260921183115_chart-explain-session-kind.ts",
    checksum:
      "eeb22ce144b0116e5c66fdcab16f1e9188aa29c925dc910d5529d385017a08eb",
  },
  {
    ...(await import("./migration/20260921210524_market-series-output"))
      .default,
    filename: "20260921210524_market-series-output.ts",
    checksum:
      "2651bb0239a7e4dca196af64771bb755425396b703a6c6135b54f3f444df26d5",
  },
  {
    ...(await import("./migration/20260921231958_symbology")).default,
    filename: "20260921231958_symbology.ts",
    checksum:
      "6ed3cf7e626715ed36e64aaf0dcc145e0247b80397302a555c172b66a5dbf8be",
  },
  {
    ...(await import("./migration/20260922024059_alert-trigger")).default,
    filename: "20260922024059_alert-trigger.ts",
    checksum:
      "5363b268a61b52d64ae2b12ab2cf6e9ba2fbdb6ef0dfe5cef510a58e98652c83",
  },
  {
    ...(await import("./migration/20260923052528_alertable")).default,
    filename: "20260923052528_alertable.ts",
    checksum:
      "a0ec78212813fad43c8c00ecfcda1a2b1c605ed8dc9dd4fdf6a44338a8ffe968",
  },
  {
    ...(await import("./migration/20260923215852_drawing-alerts")).default,
    filename: "20260923215852_drawing-alerts.ts",
    checksum:
      "b89f461a30771174dee3411a9cbe2b072e81117562eab9c7e07ce8b260854250",
  },
  {
    ...(await import("./migration/20260924050749_post-feed")).default,
    filename: "20260924050749_post-feed.ts",
    checksum:
      "d06c916d87c5c4df798b488117778af8c7fe8b0cc3c9316d25e7fedbfb1398db",
  },
  {
    ...(await import("./migration/20260924051721_drawing-boundary-touching"))
      .default,
    filename: "20260924051721_drawing-boundary-touching.ts",
    checksum:
      "a5a33676b67e5f2fc3ac880e96397ee0cbd0608864f43add539c164add4f965e",
  },
  {
    ...(await import("./migration/20260924152035_alert-post-subjects")).default,
    filename: "20260924152035_alert-post-subjects.ts",
    checksum:
      "6f0166cf7ed94cd67a8be1589a41397bd8db37fa84578241d8d8646a9a75ce81",
  },
  {
    ...(await import("./migration/20260925183938_drawing-state-constraints"))
      .default,
    filename: "20260925183938_drawing-state-constraints.ts",
    checksum:
      "47532ae32cfa0d8b8c7e983e6bf0b4b33a1abfe7a7ca9485420a107fadb6bae1",
  },
  {
    ...(await import("./migration/20260926174200_post-markdown")).default,
    filename: "20260926174200_post-markdown.ts",
    checksum:
      "fe323a2ed8aa3f5a7e8d4d3af512e5fd72982b9052361ea9d29c3c446c3d683e",
  },
  {
    ...(await import("./migration/20260926175652_post-without-kind")).default,
    filename: "20260926175652_post-without-kind.ts",
    checksum:
      "3fe17541d9fe9f6a62492b39173b94666133e8e541db6d1bcad12b467684db58",
  },
  {
    ...(await import("./migration/20260926184112_post-character-limit"))
      .default,
    filename: "20260926184112_post-character-limit.ts",
    checksum:
      "463a8bd0eb012f9edc67fa97e6d54598dfb29423894213f2ca7a618db609923f",
  },
  {
    ...(await import("./migration/20260927213244_indicator-resource")).default,
    filename: "20260927213244_indicator-resource.ts",
    checksum:
      "618f5039f211b221fd7ec30b3799d6540fe0c856797b1c9227c557f8cb92bceb",
  },
  {
    ...(await import("./migration/20260928211204_session-read-position"))
      .default,
    filename: "20260928211204_session-read-position.ts",
    checksum:
      "4ae8b4023087706694289f251c2a9b6f8be928c4405f9d6f2265a95210b5e18b",
  },
  {
    ...(await import("./migration/20261001040127_cloud-provider-session"))
      .default,
    filename: "20261001040127_cloud-provider-session.ts",
    checksum:
      "7403acda0cff7ac7ce4e07949bebc9564f654bafa961711faf00f60916c1c1dd",
  },
  {
    ...(await import("./migration/20261001085000_tea-node-config")).default,
    filename: "20261001085000_tea-node-config.ts",
    checksum:
      "ff380813cc7bf8c7da4b02b38df09ff8d444a6e0d835a67a1f784cbc0d7d151d",
  },
  {
    ...(await import("./migration/20261001125937_indicator-declaration"))
      .default,
    filename: "20261001125937_indicator-declaration.ts",
    checksum:
      "5a2b598456d00d865cb7a1df5defc7344bbff6a092de10408353b6abc7e7a2ce",
  },
  {
    ...(await import("./migration/20261002000000_remove-empty-chart-panes"))
      .default,
    filename: "20261002000000_remove-empty-chart-panes.ts",
    checksum:
      "48a89c8cd831cc700e36348c668535cdb9e45799d55146fcc9226e55598ea0ec",
  },
  {
    ...(await import("./migration/20261002220000_drawing-epoch-seconds"))
      .default,
    filename: "20261002220000_drawing-epoch-seconds.ts",
    checksum:
      "23acc7e4ffe19b6aee6489a0287576ed91cb06e75f8c3df9d8411a4d9262d059",
  },
  {
    ...(await import("./migration/20261002234117_three-bar-sessions")).default,
    filename: "20261002234117_three-bar-sessions.ts",
    checksum:
      "256465210f1cbee8394373f1f31eccf4bd035b19d5f7afacc891ca14f2242403",
  },
  {
    ...(await import("./migration/20261004054656_retired-session-inputs"))
      .default,
    filename: "20261004054656_retired-session-inputs.ts",
    checksum:
      "4a45c3454b487e67a5abdc717d6d3c508b8ade2ce105747c7286ed6ebe146d94",
  },
  {
    ...(await import("./migration/20261005033914_market-volume-profile"))
      .default,
    filename: "20261005033914_market-volume-profile.ts",
    checksum:
      "6c1c182e2e07cc4e51c87adcd488b53a1a2c431e8dd8a5e35e665b79d2a8ea78",
  },
  {
    ...(await import("./migration/20261006040216_native-listing-identity"))
      .default,
    filename: "20261006040216_native-listing-identity.ts",
    checksum:
      "d2aa23d15ad1595c6b67fc62f70c5bd4e73439cf4bc9d3d45f24592f831bfdf6",
  },
  {
    ...(await import("./migration/20261009193152_nested-watchlist-sections"))
      .default,
    filename: "20261009193152_nested-watchlist-sections.ts",
    checksum:
      "a70d0974be59dc47ef57d4820afba9c460b01b3450720a68e10d87c438af7985",
  },
] satisfies DatabaseMigration.RegisteredMigration[];
