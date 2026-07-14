(function () {
  "use strict";

  const DATA_URL = "data/catalog.json";
  const PUBLIC_EVIDENCE_CATALOG_URL = "https://terrenceyeyang.github.io/EVO/data/catalog.json";
  const STATUS_ORDER = ["verified", "experimental", "none", "planned"];
  const LEGACY_CORPUS = {
    id: "corpus-legacy-mixed-v1",
    label: "Original study mixed corpus",
    domain: "legacy_mixed",
    measurement_status: "measured"
  };
  const state = { entries: [], visible: [], byId: new Map(), corpora: [], corporaById: new Map() };

  function publishedEvidenceUrl(rawUrl) {
    const url = String(rawUrl || "").trim();
    if (!url) return PUBLIC_EVIDENCE_CATALOG_URL;
    if (/^https?:\/\/github\.com\/TerrenceYeYang\/EVO\/(?:blob|tree)\/main\/model\//i.test(url)) {
      return PUBLIC_EVIDENCE_CATALOG_URL;
    }
    return url;
  }

  const grid = document.getElementById("catalog-grid");
  const resultCount = document.getElementById("result-count");
  const filterForm = document.getElementById("catalog-filters");
  const searchInput = document.getElementById("search-input");
  const familyFilter = document.getElementById("family-filter");
  const corpusFilter = document.getElementById("corpus-filter");
  const statusFilter = document.getElementById("status-filter");
  const targetFilter = document.getElementById("target-filter");
  const opFilter = document.getElementById("op-filter");
  const resetButton = document.getElementById("reset-filters");
  const drawer = document.getElementById("detail-drawer");
  const drawerContent = document.getElementById("drawer-content");
  const drawerClose = document.getElementById("drawer-close");
  const toast = document.getElementById("copy-toast");
  const runnableLineageCount = document.getElementById("runnable-lineage-count");
  const evidenceLineageCount = document.getElementById("evidence-lineage-count");
  const verifiedGeneCount = document.getElementById("verified-gene-count");
  const verifiedRecipeCount = document.getElementById("verified-recipe-count");
  const experimentalCount = document.getElementById("experimental-count");
  const verificationGateValue = document.getElementById("verification-gate-value");
  const minimumSeedCount = document.getElementById("minimum-seed-count");
  const provenanceRunCount = document.getElementById("provenance-run-count");
  let toastTimer;
  let lastDrawerTrigger = null;
  let activeCurveCharts = [];

  function escapeHTML(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function titleCase(value) {
    return String(value || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function numeric(value) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatNumber(value, digits) {
    const number = numeric(value);
    if (number === null) return "—";
    return number.toFixed(digits == null ? 2 : digits);
  }

  function valueFrom(object, keys, fallback) {
    if (!object) return fallback;
    for (const key of keys) {
      if (object[key] !== undefined && object[key] !== null) return object[key];
    }
    return fallback;
  }

  function arrayFrom(value) {
    if (Array.isArray(value)) return value;
    if (value instanceof Map) return Array.from(value.values());
    if (value && typeof value === "object") return Object.values(value);
    return [];
  }

  function makeMap(collection) {
    return new Map(arrayFrom(collection).map(function (item) { return [item.id, item]; }));
  }

  function catalogCorpora(data) {
    const records = arrayFrom(data.corpora).map(function (corpus) {
      return Object.assign({}, corpus);
    });
    const hasUnqualifiedClaims = arrayFrom(data.claims).some(function (claim) {
      return !valueFrom(claim, ["corpus_id", "corpusId"], null);
    });
    if ((!records.length || hasUnqualifiedClaims) && !records.some(function (corpus) {
      return corpus.id === LEGACY_CORPUS.id;
    })) {
      records.unshift(Object.assign({}, LEGACY_CORPUS));
    }
    return records.length ? records : [Object.assign({}, LEGACY_CORPUS)];
  }

  function normalizeSeed(row) {
    const explicitPercent = valueFrom(row, ["improvementPct", "improvement_pct", "improvement_percent", "relative_improvement_pct"], null);
    const fraction = valueFrom(row, ["improvement", "improvement_fraction", "relative_improvement"], null);
    return {
      seed: valueFrom(row, ["seed", "seed_id"], "—"),
      baselineSteps: numeric(valueFrom(row, ["baselineSteps", "baseline_steps", "baseline_step", "parent_steps"], null)),
      candidateSteps: numeric(valueFrom(row, ["candidateSteps", "candidate_steps", "candidate_step", "dna_steps"], null)),
      improvementPct: explicitPercent !== null ? numeric(explicitPercent) : (numeric(fraction) === null ? null : numeric(fraction) * 100)
    };
  }

  const LINEAGE_ARM_LABELS = {
    fresh_empty: "Fresh empty",
    inherited_native: "Inherited native DNA",
    selected_offspring: "Selected offspring"
  };
  const LINEAGE_RATIO_LABELS = {
    inherited_native_to_fresh_empty: "Inherited / empty",
    selected_offspring_to_fresh_empty: "Offspring / empty",
    selected_offspring_to_inherited_native: "Offspring / inherited"
  };

  function normalizedBoundedValues(mean, minimum, maximum) {
    if (mean === null || minimum === null || maximum === null || minimum <= 0 || maximum <= 0 || minimum > maximum) return null;
    const tolerance = Math.max(1, Math.abs(mean), Math.abs(minimum), Math.abs(maximum)) * 1e-12;
    if (mean < minimum - tolerance || mean > maximum + tolerance) return null;
    return { mean: Math.min(maximum, Math.max(minimum, mean)), minimum: minimum, maximum: maximum };
  }

  function normalizeEnvelope(raw) {
    const envelope = raw && typeof raw === "object" ? raw : {};
    const bounded = normalizedBoundedValues(
      numeric(valueFrom(envelope, ["geometric_mean_ppl", "geometricMeanPpl"], null)),
      numeric(valueFrom(envelope, ["min_ppl", "minPpl"], null)),
      numeric(valueFrom(envelope, ["max_ppl", "maxPpl"], null))
    );
    return bounded ? {
      geometricMeanPpl: bounded.mean,
      minPpl: bounded.minimum,
      maxPpl: bounded.maximum
    } : null;
  }

  function normalizePairedRatio(raw) {
    const ratio = raw && typeof raw === "object" ? raw : {};
    const bounded = normalizedBoundedValues(
      numeric(valueFrom(ratio, ["geometric_mean", "geometricMean"], null)),
      numeric(ratio.min),
      numeric(ratio.max)
    );
    return bounded ? {
      geometricMean: bounded.mean,
      min: bounded.minimum,
      max: bounded.maximum
    } : null;
  }

  function normalizeLineageConvergenceCurve(curve, fallbackThreshold, claim) {
    const rawPoints = arrayFrom(curve.points);
    if (!rawPoints.length || !rawPoints[0] || !rawPoints[0].arms) return null;
    const supportedArms = ["fresh_empty", "inherited_native", "selected_offspring"];
    const rawArmOrder = arrayFrom(valueFrom(curve, ["arm_order", "armOrder"], []));
    const declaredArms = rawArmOrder.filter(function (key, index, rows) {
      return supportedArms.includes(key) && rows.indexOf(key) === index;
    });
    if (rawArmOrder.length && declaredArms.length !== rawArmOrder.length) return null;
    const requestedArms = declaredArms.length ? declaredArms : supportedArms;
    const armKeys = requestedArms.filter(function (key) {
      return rawPoints.every(function (row) { return row.arms && row.arms[key]; });
    });
    if (armKeys.length < 2 || armKeys[0] !== "fresh_empty" || (declaredArms.length && armKeys.length !== declaredArms.length)) return null;
    const ratioOrder = [
      "inherited_native_to_fresh_empty",
      "selected_offspring_to_fresh_empty",
      "selected_offspring_to_inherited_native"
    ];
    const ratioKeys = ratioOrder.filter(function (key) {
      return rawPoints.every(function (row) { return row.paired_ratios && row.paired_ratios[key]; });
    });
    const expectedRatioCount = armKeys.includes("selected_offspring") ? 3 : 1;
    if (ratioKeys.length !== expectedRatioCount) return null;
    const points = rawPoints.map(function (row) {
      const arms = {};
      const pairedRatios = {};
      armKeys.forEach(function (key) { arms[key] = normalizeEnvelope(row.arms[key]); });
      ratioKeys.forEach(function (key) { pairedRatios[key] = normalizePairedRatio(row.paired_ratios[key]); });
      return {
        step: numeric(row.step),
        trainingTokens: numeric(row.training_tokens),
        corpusFraction: numeric(row.corpus_fraction),
        tokensPerParameter: numeric(row.tokens_per_parameter),
        arms: arms,
        pairedRatios: pairedRatios
      };
    }).filter(function (point) {
      return point.step !== null && point.step > 0 && point.trainingTokens !== null && point.trainingTokens > 0 &&
        armKeys.every(function (key) { return point.arms[key] !== null; }) &&
        ratioKeys.every(function (key) { return point.pairedRatios[key] !== null; });
    }).sort(function (left, right) { return left.step - right.step; });
    const strictGrid = points.every(function (point, index) {
      return index === 0 || (point.step > points[index - 1].step && point.trainingTokens > points[index - 1].trainingTokens);
    });
    const thresholdPpl = numeric(valueFrom(curve.threshold || {}, ["ppl"], fallbackThreshold));
    if (points.length !== rawPoints.length || points.length < 2 || !strictGrid || thresholdPpl === null || thresholdPpl <= 0) return null;
    const parameterCount = numeric(valueFrom(curve, ["parameter_count", "model_parameter_count"], valueFrom(claim, ["model_parameter_count", "parameter_count"], null)));
    const corpusTokens = numeric(valueFrom(curve, ["corpus_prefix_tokens", "corpus_tokens"], valueFrom(claim, ["corpus_prefix_tokens", "corpus_tokens"], null)));
    const transitionTokens = numeric(valueFrom(curve, ["transition_tokens", "data_transition_tokens"], valueFrom(claim, ["transition_tokens", "data_transition_tokens"], null)));
    return {
      mode: "lineage",
      points: points,
      armKeys: armKeys,
      ratioKeys: ratioKeys,
      thresholdPpl: thresholdPpl,
      parameterCount: parameterCount,
      corpusTokens: corpusTokens,
      transitionTokens: transitionTokens
    };
  }

  function normalizeConvergenceCurve(curve, fallbackThreshold, claim) {
    if (!curve || typeof curve !== "object") return null;
    const lineage = normalizeLineageConvergenceCurve(curve, fallbackThreshold, claim || {});
    if (lineage) return lineage;
    const rawPairPoints = arrayFrom(curve.points);
    const points = rawPairPoints.map(function (row) {
      const empty = row && row.empty || {};
      const gene = row && row.gene || {};
      const ratio = row && row.paired_gene_to_empty_ratio || {};
      return {
        step: numeric(row && row.step),
        trainingTokens: numeric(row && row.training_tokens),
        corpusFraction: numeric(row && row.corpus_fraction),
        tokensPerParameter: numeric(row && row.tokens_per_parameter),
        empty: normalizeEnvelope(empty),
        gene: normalizeEnvelope(gene),
        ratio: normalizePairedRatio(ratio)
      };
    }).filter(function (point) {
      return point.step !== null && point.step > 0 && point.trainingTokens !== null && point.trainingTokens > 0 &&
        point.empty !== null && point.gene !== null && point.ratio !== null;
    }).sort(function (left, right) { return left.step - right.step; });
    const hasStrictGrid = points.every(function (point, index) {
      return index === 0 || (
        point.step > points[index - 1].step &&
        point.trainingTokens > points[index - 1].trainingTokens
      );
    });
    const threshold = curve.threshold || {};
    const thresholdPpl = numeric(valueFrom(threshold, ["ppl"], fallbackThreshold));
    if (points.length !== rawPairPoints.length || points.length < 2 || !hasStrictGrid || thresholdPpl === null || thresholdPpl <= 0) return null;
    return {
      mode: "pair",
      points: points,
      thresholdPpl: thresholdPpl,
      parameterCount: numeric(valueFrom(curve, ["parameter_count", "model_parameter_count"], valueFrom(claim || {}, ["model_parameter_count", "parameter_count"], null))),
      corpusTokens: numeric(valueFrom(curve, ["corpus_prefix_tokens", "corpus_tokens"], valueFrom(claim || {}, ["corpus_prefix_tokens", "corpus_tokens"], null))),
      transitionTokens: numeric(valueFrom(curve, ["transition_tokens", "data_transition_tokens"], valueFrom(claim || {}, ["transition_tokens", "data_transition_tokens"], null)))
    };
  }

  function normalizeWidthScalingEvidence(rawEvidence, corpora) {
    if (!rawEvidence || typeof rawEvidence !== "object") return null;
    const primary = rawEvidence.primary && typeof rawEvidence.primary === "object" ? rawEvidence.primary : {};
    const profiles = arrayFrom(valueFrom(rawEvidence, ["profiles"], primary.profiles)).map(function (profile) {
      return {
        variantId: valueFrom(profile, ["variant_id", "variantId", "profile_id", "profileId"], null),
        label: valueFrom(profile, ["label", "name"], valueFrom(profile, ["variant_id", "variantId", "profile_id", "profileId"], "Measured parameter count")),
        widthMultiplier: numeric(valueFrom(profile, ["width_multiplier", "widthMultiplier"], null)),
        parameterCount: numeric(valueFrom(profile, ["parameter_count", "parameterCount"], null))
      };
    }).filter(function (profile) {
      return profile.variantId && profile.parameterCount !== null && profile.parameterCount > 0;
    }).sort(function (left, right) { return left.parameterCount - right.parameterCount; });
    const profilesById = new Map(profiles.map(function (profile) { return [profile.variantId, profile]; }));
    const rawCorpusIds = arrayFrom(valueFrom(rawEvidence, ["corpus_ids", "corpusIds"], valueFrom(primary, ["corpus_ids", "corpusIds"], [])));

    function normalizeScalingCell(cell, fallbackStep, fallbackTokens) {
      const ratio = valueFrom(cell, ["paired_gene_to_empty_ratio", "ratio"], {}) || {};
      const variantId = valueFrom(cell, ["variant_id", "variantId", "profile_id", "profileId"], null);
      const corpusId = valueFrom(cell, ["corpus_id", "corpusId"], null);
      const profile = profilesById.get(variantId) || {};
      const meanRatio = numeric(valueFrom(cell, ["geometric_mean_dna_to_empty_ratio", "geometricMeanDnaToEmptyRatio"], valueFrom(ratio, ["geometric_mean", "geometricMean"], null)));
      const minRatio = numeric(valueFrom(cell, ["min_dna_to_empty_ratio", "minDnaToEmptyRatio"], valueFrom(ratio, ["min"], null)));
      const maxRatio = numeric(valueFrom(cell, ["max_dna_to_empty_ratio", "maxDnaToEmptyRatio"], valueFrom(ratio, ["max"], null)));
      const parameterCount = numeric(valueFrom(cell, ["parameter_count", "parameterCount"], profile.parameterCount));
      if (!variantId || !corpusId || parameterCount === null || parameterCount <= 0 || meanRatio === null || minRatio === null || maxRatio === null || minRatio <= 0 || minRatio > meanRatio || meanRatio > maxRatio) return null;
      const corpus = corpora.get(corpusId) || {};
      return {
        variantId: variantId,
        variantLabel: profile.label || variantId,
        corpusId: corpusId,
        corpusLabel: valueFrom(corpus, ["label", "name"], corpusId),
        parameterCount: parameterCount,
        step: numeric(valueFrom(cell, ["step"], fallbackStep)),
        trainingTokens: numeric(valueFrom(cell, ["training_tokens", "trainingTokens"], fallbackTokens)),
        meanRatio: meanRatio,
        minRatio: minRatio,
        maxRatio: maxRatio,
        meanLogAdvantage: numeric(valueFrom(cell, ["mean_log_ppl_advantage", "meanLogPplAdvantage"], null)),
        minLogAdvantage: numeric(valueFrom(cell, ["min_log_ppl_advantage", "minLogPplAdvantage"], null)),
        maxLogAdvantage: numeric(valueFrom(cell, ["max_log_ppl_advantage", "maxLogPplAdvantage"], null))
      };
    }

    let rawAnchors = arrayFrom(valueFrom(rawEvidence, ["fixed_token_anchors", "fixedTokenAnchors"], []));
    if (!rawAnchors.length && Array.isArray(primary.cells)) {
      rawAnchors = arrayFrom(valueFrom(primary, ["fixed_anchor_steps", "fixedAnchorSteps"], [])).map(function (step) {
        const cells = primary.cells.map(function (cell) {
          const point = valueFrom(cell.anchors || {}, [String(step)], null);
          return point ? Object.assign({}, point, {
            variant_id: valueFrom(cell, ["variant_id", "variantId"], null),
            corpus_id: valueFrom(cell, ["corpus_id", "corpusId"], null),
            parameter_count: valueFrom(cell, ["parameter_count", "parameterCount"], null)
          }) : null;
        }).filter(Boolean);
        return { step: step, training_tokens: cells[0] && valueFrom(cells[0], ["training_tokens", "trainingTokens"], null), cells: cells };
      });
    }
    const anchors = rawAnchors.map(function (anchor) {
      const step = numeric(valueFrom(anchor, ["step"], null));
      const trainingTokens = numeric(valueFrom(anchor, ["training_tokens", "trainingTokens"], null));
      const cells = arrayFrom(anchor.cells).map(function (cell) {
        return normalizeScalingCell(cell, step, trainingTokens);
      }).filter(Boolean);
      return { step: step, trainingTokens: trainingTokens, cells: cells };
    }).filter(function (anchor) {
      return anchor.step !== null && anchor.step > 0 && anchor.trainingTokens !== null && anchor.trainingTokens > 0 && anchor.cells.length;
    }).sort(function (left, right) { return left.trainingTokens - right.trainingTokens; });
    const corpusIds = rawCorpusIds.length ? rawCorpusIds : Array.from(new Set(anchors.flatMap(function (anchor) {
      return anchor.cells.map(function (cell) { return cell.corpusId; });
    })));
    const trend = rawEvidence.trend || primary.trend || {};
    const seedRows = arrayFrom(valueFrom(trend, ["seed_rows", "seedRows"], [])).map(function (row) {
      return {
        seed: valueFrom(row, ["seed", "seed_id", "seedId"], "—"),
        slope: numeric(valueFrom(row, ["slope_per_parameter_doubling", "slopePerParameterDoubling"], null))
      };
    }).filter(function (row) { return row.slope !== null; });
    const hasStrictProfileGrid = profiles.every(function (profile, index) {
      return index === 0 || profile.parameterCount > profiles[index - 1].parameterCount;
    });
    const hasStrictAnchorGrid = anchors.every(function (anchor, index) {
      return index === 0 || anchor.trainingTokens > anchors[index - 1].trainingTokens;
    });
    if (profiles.length < 2 || corpusIds.length < 1 || anchors.length < 1 || !hasStrictProfileGrid || !hasStrictAnchorGrid) return null;
    return {
      studyId: valueFrom(rawEvidence, ["study_id", "studyId"], "fixed-DNA measured-parameter study"),
      profiles: profiles,
      corpusIds: corpusIds,
      anchors: anchors,
      trend: {
        classification: valueFrom(trend, ["classification"], "inconclusive"),
        meanSlope: numeric(valueFrom(trend, ["mean_slope_per_parameter_doubling", "meanSlopePerParameterDoubling"], null)),
        seedRows: seedRows,
        method: valueFrom(trend, ["method"], "Seed-blocked descriptive slope"),
        scope: valueFrom(trend, ["scope"], valueFrom(rawEvidence, ["inference_scope", "inferenceScope"], "descriptive fixed-recipe parameter-count trend; not a scaling law")),
        inferential: valueFrom(trend, ["inferential"], false) === true
      }
    };
  }

  function normalizeJointScalingEvidence(rawEvidence) {
    if (!rawEvidence || typeof rawEvidence !== "object") return null;

    const rawProfiles = Array.isArray(rawEvidence.profiles)
      ? rawEvidence.profiles
      : Object.entries(rawEvidence.profiles || {}).map(function (pair) {
        return Object.assign({ profile_id: pair[0] }, pair[1]);
      });
    const profiles = rawProfiles.map(function (profile) {
      return {
        profileId: valueFrom(profile, ["profile_id", "profileId", "variant_id", "variantId", "id"], null),
        label: valueFrom(profile, ["label", "name"], valueFrom(profile, ["profile_id", "profileId", "variant_id", "variantId", "id"], "Measured Phi-4-style proxy")),
        nominalScale: numeric(valueFrom(profile, ["nominal_joint_scale", "nominalJointScale", "nominal_data_scale", "nominalDataScale", "nominal_parameter_scale", "nominalParameterScale"], null)),
        parameterCount: numeric(valueFrom(profile, ["actual_parameter_count", "actualParameterCount", "parameter_count", "parameterCount"], null)),
        actualParameterRatio: numeric(valueFrom(profile, ["actual_parameter_ratio", "actualParameterRatio"], null)),
        transitionTokens: numeric(valueFrom(profile, ["transition_tokens", "transitionTokens", "data_transition_tokens", "dataTransitionTokens"], null)),
        prefixLength: numeric(valueFrom(profile, ["prefix_length", "prefixLength"], null))
      };
    }).filter(function (profile) {
      return profile.profileId && profile.nominalScale !== null && profile.parameterCount !== null &&
        profile.actualParameterRatio !== null && profile.transitionTokens !== null && profile.prefixLength !== null &&
        profile.nominalScale > 0 && profile.parameterCount > 0 && profile.actualParameterRatio > 0 &&
        profile.transitionTokens > 0 && profile.prefixLength === profile.transitionTokens + 1;
    }).sort(function (left, right) { return left.nominalScale - right.nominalScale; });
    if (profiles.length !== 3 || profiles.map(function (profile) { return profile.nominalScale; }).join(",") !== "1,4,9") return null;
    if (!profiles.every(function (profile, index) {
      if (index === 0) return Math.abs(profile.actualParameterRatio - 1) < 1e-6;
      return profile.parameterCount > profiles[index - 1].parameterCount &&
        profile.transitionTokens > profiles[index - 1].transitionTokens &&
        profile.actualParameterRatio > profiles[index - 1].actualParameterRatio;
    })) return null;
    if (!profiles.every(function (profile) {
      return Math.abs(profile.parameterCount / profiles[0].parameterCount - profile.actualParameterRatio) < 1e-6 &&
        profile.transitionTokens === profiles[0].transitionTokens * profile.nominalScale;
    })) return null;

    const profileById = new Map(profiles.map(function (profile) { return [profile.profileId, profile]; }));
    const profileByScale = new Map(profiles.map(function (profile) { return [profile.nominalScale, profile]; }));
    const roleOrder = ["encyclopedic", "news", "balanced_mix"];
    const fallbackCorpusLabels = {
      encyclopedic: "Encyclopedic English · independent master",
      news: "English news · independent master",
      balanced_mix: "Balanced encyclopedia + news · independent master"
    };
    const rawCorpora = Array.isArray(rawEvidence.corpora)
      ? rawEvidence.corpora
      : Object.entries(rawEvidence.corpora || {}).map(function (pair) {
        return Object.assign({ role: pair[0] }, pair[1]);
      });
    const corpora = rawCorpora.map(function (corpus) {
      const role = valueFrom(corpus, ["role", "corpus_role", "corpusRole", "domain"], null);
      const source = valueFrom(corpus, ["source", "source_snapshot", "sourceSnapshot"], {}) || {};
      return {
        role: role,
        corpusId: valueFrom(corpus, ["corpus_id", "corpusId", "id"], role),
        label: valueFrom(corpus, ["label", "name"], fallbackCorpusLabels[role] || role),
        sourceLabel: valueFrom(corpus, ["source_label", "sourceLabel", "dataset"], valueFrom(source, ["label", "dataset", "dataset_id", "datasetId"], null)),
        masterTrainTokens: numeric(valueFrom(corpus, ["train_tokens", "trainTokens", "master_train_tokens", "masterTrainTokens"], null)),
        validationTokens: numeric(valueFrom(corpus, ["held_out_validation_tokens", "heldOutValidationTokens", "val_tokens", "valTokens", "validation_tokens", "validationTokens"], null))
      };
    }).filter(function (corpus) {
      return roleOrder.includes(corpus.role) && corpus.corpusId && corpus.label;
    }).sort(function (left, right) { return roleOrder.indexOf(left.role) - roleOrder.indexOf(right.role); });
    if (corpora.length !== 3 || corpora.map(function (corpus) { return corpus.role; }).join(",") !== roleOrder.join(",")) return null;
    const corpusByRole = new Map(corpora.map(function (corpus) { return [corpus.role, corpus]; }));

    function normalizeJointCurve(curve, thresholdPpl, profile) {
      const normalized = normalizeConvergenceCurve(curve, thresholdPpl);
      if (!normalized || normalized.points.length !== 32) return null;
      const valid = normalized.points.every(function (point, index) {
        const expectedFraction = (index + 1) / 32;
        return point.corpusFraction !== null && point.tokensPerParameter !== null &&
          Math.abs(point.corpusFraction - expectedFraction) < 1e-9 &&
          Math.abs(point.trainingTokens / profile.transitionTokens - point.corpusFraction) < 1e-9 &&
          Math.abs(point.trainingTokens / profile.parameterCount - point.tokensPerParameter) < 1e-9;
      });
      return valid ? normalized : null;
    }

    const seenCells = new Set();
    const cells = arrayFrom(rawEvidence.cells).map(function (cell) {
      const profileId = valueFrom(cell, ["profile_id", "profileId", "variant_id", "variantId"], null);
      const nominalScale = numeric(valueFrom(cell, ["nominal_joint_scale", "nominalJointScale"], null));
      const profile = profileById.get(profileId) || profileByScale.get(nominalScale);
      const corpusRole = valueFrom(cell, ["corpus_role", "corpusRole", "role"], null);
      const corpus = corpusByRole.get(corpusRole);
      const threshold = cell.threshold || {};
      const result = cell.result || {};
      const thresholdPpl = numeric(valueFrom(threshold, ["ppl_threshold", "pplThreshold", "ppl"], null));
      if (!profile || !corpus || thresholdPpl === null || thresholdPpl <= 0) return null;
      const curve = normalizeJointCurve(cell.convergence_curve || cell.convergenceCurve, thresholdPpl, profile);
      const perSeed = arrayFrom(valueFrom(cell, ["per_seed", "perSeed"], [])).map(function (row) {
        return {
          seed: valueFrom(row, ["seed", "seed_id", "seedId"], "—"),
          emptyTokens: numeric(valueFrom(row, ["empty_tokens_to_threshold", "emptyTokensToThreshold"], null)),
          geneTokens: numeric(valueFrom(row, ["gene_tokens_to_threshold", "geneTokensToThreshold"], null)),
          pairedGain: numeric(valueFrom(row, ["paired_gain", "pairedGain"], null))
        };
      });
      const gain = numeric(valueFrom(result, ["ratio_of_means_gain", "ratioOfMeansGain"], null));
      const positiveSeeds = numeric(valueFrom(result, ["positive_paired_seeds", "positivePairedSeeds"], null));
      const rightCensored = numeric(valueFrom(result, ["right_censored_run_count", "rightCensoredRunCount"], null));
      if (!curve || perSeed.length !== 5 || positiveSeeds === null || rightCensored === null) return null;
      const key = profile.profileId + "\u0000" + corpus.role;
      if (seenCells.has(key)) return null;
      seenCells.add(key);
      return {
        key: key,
        profile: profile,
        corpus: corpus,
        thresholdPpl: thresholdPpl,
        gain: gain,
        positiveSeeds: positiveSeeds,
        rightCensored: rightCensored,
        aucGain: numeric(valueFrom(result, ["normalized_log_ppl_excess_auc_gain", "normalizedLogPplExcessAucGain"], null)),
        gatePassed: valueFrom(result, ["gate_passed", "gatePassed"], false) === true,
        emptyMeanTokens: numeric(valueFrom(result, ["empty_mean_tokens_to_threshold", "emptyMeanTokensToThreshold"], null)),
        geneMeanTokens: numeric(valueFrom(result, ["gene_mean_tokens_to_threshold", "geneMeanTokensToThreshold"], null)),
        perSeed: perSeed,
        curve: curve
      };
    });
    if (cells.length !== 9 || cells.some(function (cell) { return !cell; })) return null;
    const completeGrid = profiles.every(function (profile) {
      return corpora.every(function (corpus) { return seenCells.has(profile.profileId + "\u0000" + corpus.role); });
    });
    if (!completeGrid) return null;

    const trend = rawEvidence.trend;
    const sliceContract = rawEvidence.slice_contract || rawEvidence.sliceContract;
    const source = rawEvidence.source || {};
    if (!trend || typeof trend !== "object" || !sliceContract || typeof sliceContract !== "object" || !source || typeof source !== "object") return null;
    const seedRows = arrayFrom(valueFrom(trend, ["seed_rows", "seedRows"], [])).map(function (row) {
      return {
        seed: valueFrom(row, ["seed", "seed_id", "seedId"], "—"),
        slope: numeric(valueFrom(row, ["slope_per_nominal_scale_doubling", "slopePerNominalScaleDoubling"], null))
      };
    });
    const studyId = valueFrom(rawEvidence, ["study_id", "studyId"], null);
    if (!studyId) return null;
    const sourceUrl = publishedEvidenceUrl(valueFrom(source, ["url", "evidence_url", "evidenceUrl"], null));
    return {
      studyId: studyId,
      profiles: profiles,
      corpora: corpora,
      cells: cells,
      trend: {
        classification: valueFrom(trend, ["classification"], "inconclusive"),
        meanSlope: numeric(valueFrom(trend, ["mean_slope_per_nominal_scale_doubling", "meanSlopePerNominalScaleDoubling"], null)),
        seedRows: seedRows,
        scope: valueFrom(trend, ["scope"], "descriptive joint model-and-corpus trend; effects are not separable"),
        inferential: valueFrom(trend, ["inferential"], false) === true
      },
      sliceContract: sliceContract,
      sourceUrl: sourceUrl
    };
  }

  function normalizeClaim(claim, experiments, variants, corpora) {
    const result = claim.result || {};
    const validation = claim.validation || {};
    const gate = claim.gate || {};
    const experimentId = valueFrom(claim, ["experiment_id", "experimentId"], null);
    const experiment = experiments.get(experimentId) || arrayFrom(experiments).find(function (item) {
      return arrayFrom(item.claim_ids).includes(claim.id);
    }) || {};
    const variantId = valueFrom(claim, ["variant_id", "variantId"], valueFrom(experiment, ["variant_id", "variantId"], null));
    const variant = variants.get(variantId) || {};
    const corpusId = valueFrom(claim, ["corpus_id", "corpusId"], valueFrom(experiment, ["corpus_id", "corpusId"], LEGACY_CORPUS.id));
    const corpus = corpora.get(corpusId) || (corpusId === LEGACY_CORPUS.id ? LEGACY_CORPUS : {});
    const rawSeeds = valueFrom(claim, ["seeds", "per_seed", "perSeed", "paired_results"], valueFrom(validation, ["per_seed", "perSeed", "seeds"], valueFrom(experiment, ["seeds", "runs", "per_seed", "perSeed"], [])));
    const seeds = arrayFrom(rawSeeds).map(normalizeSeed);
    const pairedRuns = numeric(valueFrom(claim, ["pairedRuns", "paired_runs", "seed_count", "runs"], valueFrom(validation, ["seed_count", "paired_runs"], seeds.length)));
    const pairedWins = numeric(valueFrom(claim, ["pairedWins", "paired_wins", "wins"], seeds.filter(function (row) { return row.improvementPct !== null && row.improvementPct > 0; }).length));
    let improvement = numeric(valueFrom(claim, ["meanImprovementPct", "mean_improvement_pct", "improvement_pct", "effect_pct", "value"], valueFrom(result, ["improvement_percent"], null)));
    if (improvement === null && numeric(result.improvement_fraction) !== null) improvement = numeric(result.improvement_fraction) * 100;
    const thresholdHits = valueFrom(claim, ["allThresholdHits", "all_threshold_hits"], valueFrom(validation, ["all_threshold_hits"], valueFrom(experiment, ["all_threshold_hits", "allThresholdHits"], null)));
    const passes = valueFrom(claim, ["passesAtlasGate", "passes_atlas_gate", "gate_passed", "verified"], valueFrom(gate, ["passed"], improvement !== null && improvement >= 10));
    const baselineKind = valueFrom(validation, ["baseline_kind"], null);
    const comparison = baselineKind === "fresh_empty" ? "fresh empty DNA" : baselineKind === "inherited_recipe" ? "inherited one-gene parent" : valueFrom(claim, ["comparison", "baseline", "compared_with"], "documented baseline");
    const config = variant.configuration || {};
    const variantName = valueFrom(variant, ["name", "title"], "Model variant");
    const variantParameterCount = numeric(variant.parameter_count);
    const variantParameterLabel = variantParameterCount === null ? null : Number(variantParameterCount).toLocaleString() + " parameters";
    const variantBits = [
      variantName,
      variantParameterLabel && !String(variantName).includes(Number(variantParameterCount).toLocaleString()) ? variantParameterLabel : null,
      config.n_layer ? config.n_layer + " layers" : null,
      config.n_embd ? "d=" + config.n_embd : null
    ].filter(Boolean);

    const thresholdPpl = numeric(valueFrom(result, ["threshold_ppl", "thresholdPpl"], null));
    return {
      id: claim.id,
      label: valueFrom(claim, ["label", "title", "name"], "Paired evidence"),
      variantId: variantId,
      variantLabel: valueFrom(variant, ["name", "title"], variantId || "Model variant"),
      corpusId: corpusId,
      corpusLabel: valueFrom(corpus, ["label", "name"], corpusId || LEGACY_CORPUS.label),
      evidenceStatus: String(valueFrom(claim, ["evidence_status", "status"], valueFrom(gate, ["passed"], false) ? "verified" : "experimental")).toLowerCase(),
      thresholdPpl: thresholdPpl,
      protocolId: valueFrom(claim, ["protocol_id", "protocolId"], null),
      effectKey: valueFrom(claim, ["effect_key", "effectKey"], null),
      subjectId: valueFrom(claim, ["subject_id", "subjectId", "fragment_id", "recipe_id"], null),
      subjectType: valueFrom(claim, ["subject_type", "subjectType", "kind"], null),
      baselineKind: baselineKind,
      comparison: comparison,
      model: valueFrom(claim, ["model", "model_label"], variantBits.join(" · ")),
      baselineMeanSteps: numeric(valueFrom(claim, ["baselineMeanSteps", "baseline_mean_steps", "baseline_steps_mean"], valueFrom(result, ["baseline_mean_steps"], null))),
      candidateMeanSteps: numeric(valueFrom(claim, ["candidateMeanSteps", "candidate_mean_steps", "candidate_steps_mean"], valueFrom(result, ["candidate_mean_steps"], null))),
      baselineMeanTokens: numeric(valueFrom(result, ["baseline_mean_tokens_to_threshold", "baselineMeanTokensToThreshold"], null)),
      candidateMeanTokens: numeric(valueFrom(result, ["candidate_mean_tokens_to_threshold", "candidateMeanTokensToThreshold"], null)),
      meanImprovementPct: improvement,
      pairedWins: pairedWins,
      pairedRuns: pairedRuns,
      allThresholdHits: Boolean(thresholdHits),
      passesAtlasGate: Boolean(passes),
      seeds: seeds,
      convergenceCurve: normalizeConvergenceCurve(claim.convergence_curve, thresholdPpl, claim)
    };
  }

  const ASSURANCE_STATUSES = ["passed", "failed", "experimental", "not-applicable"];

  function assuranceText(value, fieldName) {
    if (value === null || value === undefined || value === "") return null;
    if (Array.isArray(value)) return value.map(assuranceText).filter(Boolean).join(", ");
    if (typeof value === "object") {
      const label = valueFrom(value, ["label", "name", "artifact", "kind"], null);
      const hash = valueFrom(value, ["self_sha256", "sha256", "hash", "protocol_sha256"], null);
      if (label || hash) return [label, hash ? "SHA-256 " + hash : null].filter(Boolean).join(" · ");
      return Object.entries(value).map(function (pair) {
        return titleCase(String(pair[0]).replaceAll("-", " ")) + ": " + assuranceText(pair[1], pair[0]);
      }).filter(function (text) { return !text.endsWith(": null"); }).join(" · ");
    }
    if (typeof value === "boolean") return value ? "yes" : "no";
    if (typeof value === "number" && /gain$/i.test(String(fieldName || "")) && Math.abs(value) <= 2) {
      return signedPercent(value * 100);
    }
    if (typeof value === "number" && /(count|tokens|parameter|scalars|markers|step)$/i.test(String(fieldName || ""))) {
      return Number(value).toLocaleString();
    }
    return String(value);
  }

  function normalizeAssurancePassport(rawPassport) {
    if (!rawPassport || typeof rawPassport !== "object") return null;
    const items = arrayFrom(valueFrom(rawPassport, ["items", "checks", "stages"], [])).map(function (item, index) {
      if (!item || typeof item !== "object") return null;
      const rawStatus = String(valueFrom(item, ["status"], "experimental")).toLowerCase().replaceAll("_", "-");
      const status = ASSURANCE_STATUSES.includes(rawStatus) ? rawStatus : "experimental";
      const stage = assuranceText(valueFrom(item, ["label", "stage", "title", "name"], null));
      if (!stage) return null;
      const performedValue = valueFrom(item, ["performed", "executed"], status !== "not-applicable");
      const heldOutValue = valueFrom(item, ["held_out", "heldOut"], null);
      return {
        id: assuranceText(valueFrom(item, ["id"], "assurance-item-" + (index + 1))),
        stage: stage,
        status: status,
        performed: performedValue === true,
        heldOut: typeof heldOutValue === "boolean" ? heldOutValue : null,
        control: assuranceText(valueFrom(item, ["control", "baseline", "comparison"], null)),
        seeds: assuranceText(valueFrom(item, ["seeds", "seed_ids", "seedIds"], null)),
        runCount: numeric(valueFrom(item, ["run_count", "runCount", "runs"], null)),
        metric: assuranceText(valueFrom(item, ["metric", "measure"], null)),
        result: assuranceText(valueFrom(item, ["result", "outcome", "summary"], null)),
        evidenceAnchor: assuranceText(valueFrom(item, ["evidence_anchor", "evidenceAnchor", "anchor"], null))
      };
    }).filter(Boolean);
    if (!items.length) return null;
    const rawScope = assuranceText(valueFrom(rawPassport, ["scope"], "All linked discovery, validation, control, breeding, ablation, and integrity checks recorded for this DNA."));
    return {
      schemaVersion: valueFrom(rawPassport, ["schema_version", "schemaVersion"], null),
      scope: rawScope && !/\s/.test(rawScope) ? titleCase(rawScope.replaceAll("-", " ")) : rawScope,
      statusVocabulary: arrayFrom(valueFrom(rawPassport, ["status_vocabulary", "statusVocabulary"], ASSURANCE_STATUSES)),
      items: items
    };
  }

  function payloadFromFragment(fragment) {
    if (fragment.payload) return fragment.payload;
    if (fragment.dna) return fragment.dna;
    const gene = fragment.gene || {
      target: valueFrom(fragment, ["target", "selector"], "TBD"),
      op: valueFrom(fragment, ["op", "operation"], "TBD"),
      value: valueFrom(fragment, ["value", "parameter"], null)
    };
    return { genes: [gene] };
  }

  function relationalEntries(data) {
    const families = makeMap(data.families);
    const variants = makeMap(data.variants);
    const experiments = makeMap(data.experiments);
    const protocols = makeMap(data.protocols);
    const corpusRecords = catalogCorpora(data);
    const corpora = makeMap(corpusRecords);
    const claims = arrayFrom(data.claims);
    const fragments = arrayFrom(data.fragments);
    const recipes = arrayFrom(data.recipes);
    const entries = [];

    function familyFor(subject) {
      const variantId = valueFrom(subject, ["variant_id", "variantId"], null);
      const variant = variants.get(variantId) || {};
      const familyId = valueFrom(subject, ["family_id", "familyId"], valueFrom(variant, ["family_id", "familyId"], null));
      return families.get(familyId) || {};
    }

    function familyLabel(family, fallback) {
      if (family.id === "phi4") return "Phi-4-style proxy";
      return valueFrom(family, ["label", "name", "title"], fallback || "Unknown family");
    }

    function claimsFor(subject, kind) {
      const ids = new Set(arrayFrom(valueFrom(subject, ["claim_ids", "claimIds"], [])));
      return claims.filter(function (claim) {
        const subjectId = valueFrom(claim, ["subject_id", "subjectId", "fragment_id", "recipe_id"], null);
        const subjectType = valueFrom(claim, ["subject_type", "subjectType", "kind"], "");
        return ids.has(claim.id) || (subjectId === subject.id && (!subjectType || subjectType === kind || subjectType === kind.replace(/e$/, "")));
      }).map(function (claim) { return normalizeClaim(claim, experiments, variants, corpora); });
    }

    function assurancePassportFor(subject, subjectClaims) {
      const explicit = normalizeAssurancePassport(valueFrom(subject, ["assurance_passport", "assurancePassport"], null));
      if (explicit) return explicit;
      const items = subjectClaims.map(function (claim) {
        const rawClaim = claims.find(function (row) { return row.id === claim.id; }) || {};
        const protocol = protocols.get(claim.protocolId) || {};
        const direct = claim.subjectId === subject.id;
        const heldOut = valueFrom(protocol, ["held_out"], null);
        const designLabel = heldOut === true ? "held-out claim" : heldOut === false ? "search / non-held-out record" : "validation record";
        const gatePassed = valueFrom(rawClaim.gate || {}, ["passed"], null);
        const protocolHashes = arrayFrom(valueFrom(protocol, ["protocol_shas"], [])).filter(function (value) {
          return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
        });
        return {
          id: claim.id,
          stage: (direct ? "Direct " + designLabel + " · " : "Associated control · ") + claim.label,
          status: gatePassed === true ? "passed" : gatePassed === false ? "failed" : (claim.evidenceStatus === "verified" ? "passed" : "experimental"),
          performed: true,
          held_out: heldOut,
          control: claim.comparison,
          seeds: claim.seeds.map(function (row) { return row.seed; }),
          run_count: claim.pairedRuns === null ? null : claim.pairedRuns * 2,
          metric: titleCase(valueFrom(protocol, ["metric"], "PPL convergence")),
          result: signedPercent(claim.meanImprovementPct) + " · " + claim.pairedWins + "/" + claim.pairedRuns + " positive seeds · " + (claim.allThresholdHits ? "all threshold hits" : "threshold misses recorded"),
          evidence_anchor: protocolHashes.length ? "Frozen protocol · SHA-256 " + protocolHashes[0] : "Frozen catalog protocol"
        };
      });
      return normalizeAssurancePassport({
        schema_version: "derived-from-catalog-claims",
        scope: "Every direct and associated measured claim linked to this published DNA record. Discovery/search stages appear only when their evidence is explicitly recorded.",
        status_vocabulary: ASSURANCE_STATUSES,
        items: items
      });
    }

    function matrixFor(subject, subjectClaims, variantKeys) {
      const directClaims = subjectClaims.filter(function (claim) {
        return claim.subjectId === subject.id;
      });
      const variantIds = Array.from(new Set(arrayFrom(valueFrom(subject, variantKeys, [])).concat(
        directClaims.map(function (claim) { return claim.variantId; }).filter(Boolean)
      )));
      return variantIds.map(function (variantId) {
        const variant = variants.get(variantId) || {};
        return {
          variantId: variantId,
          variantLabel: valueFrom(variant, ["name", "title"], variantId),
          parameterCount: numeric(valueFrom(variant, ["parameter_count", "parameterCount"], null)),
          widthMultiplier: numeric(valueFrom(variant, ["width_multiplier", "widthMultiplier"], null)),
          cells: corpusRecords.map(function (corpus) {
            return {
              corpusId: corpus.id,
              corpusLabel: valueFrom(corpus, ["label", "name"], corpus.id),
              claim: directClaims.find(function (claim) {
                return claim.variantId === variantId && claim.corpusId === corpus.id;
              }) || null
            };
          })
        };
      });
    }

    function evidenceLinksFor(subject, subjectClaims) {
      const explicit = valueFrom(subject, ["evidence_url", "evidenceUrl", "source_url"], null);
      if (explicit) return [{ url: publishedEvidenceUrl(explicit), label: "Open documented evidence", corpusIds: [] }];
      const claimIds = new Set(arrayFrom(valueFrom(subject, ["claim_ids", "claimIds"], [])).concat(subjectClaims.map(function (claim) { return claim.id; })));
      const matching = arrayFrom(data.experiments).filter(function (item) {
        return arrayFrom(item.claim_ids).some(function (id) { return claimIds.has(id); });
      });
      const grouped = new Map();
      matching.forEach(function (experiment) {
        const source = valueFrom(experiment, ["source", "run_root", "artifact_root"], null);
        if (!source) return;
        const url = /^https?:\/\//i.test(String(source))
          ? publishedEvidenceUrl(source)
          : PUBLIC_EVIDENCE_CATALOG_URL;
        if (!url) return;
        const corpusId = valueFrom(experiment, ["corpus_id", "corpusId"], null);
        const current = grouped.get(url) || { url: url, kinds: new Set(), corpusIds: new Set() };
        current.kinds.add(valueFrom(experiment, ["kind"], "documented validation"));
        if (corpusId) current.corpusIds.add(corpusId);
        grouped.set(url, current);
      });
      return Array.from(grouped.values()).map(function (record) {
        const corpusIds = Array.from(record.corpusIds);
        const corpusLabels = corpusIds.map(function (corpusId) {
          const corpus = corpora.get(corpusId) || {};
          return valueFrom(corpus, ["label", "name"], corpusId);
        });
        return {
          url: record.url,
          corpusIds: corpusIds,
          label: corpusLabels.length > 1
            ? "Open cross-corpus evidence (" + corpusLabels.length + " corpora)"
            : "Open " + (corpusLabels[0] || "raw") + " evidence"
        };
      });
    }

    function passportFor(subject, subjectClaims, selectedCorpusId) {
      if (subject.passport) return subject.passport;
      const directClaims = subjectClaims.filter(function (claim) {
        return claim.subjectId === subject.id;
      });
      const selectedClaims = selectedCorpusId
        ? directClaims.filter(function (claim) { return claim.corpusId === selectedCorpusId; })
        : directClaims.slice(0, 1);
      if (selectedCorpusId && !selectedClaims.length) {
        const selectedCorpus = corpora.get(selectedCorpusId) || {};
        return {
          "Selected corpus": valueFrom(selectedCorpus, ["label", "name"], selectedCorpusId),
          "Evidence status": "Untested — no model × corpus claim exists; this is not a measured 0% effect",
          "Known evidence": directClaims.length + " measured claim" + (directClaims.length === 1 ? "" : "s") + " on other registered corpus/model cells",
          "Limitations": valueFrom(subject, ["limitations", "caveat", "status_reason"], "Research micro-model evidence; not an official checkpoint claim.")
        };
      }
      const selectedClaim = selectedClaims[0] || null;
      const claimRecords = selectedClaims.map(function (normalizedClaim) {
        return claims.find(function (claim) { return normalizedClaim.id === claim.id; }) || {};
      });
      const experimentRecords = claimRecords.map(function (claimRecord) {
        const explicit = experiments.get(valueFrom(claimRecord, ["experiment_id", "experimentId"], null));
        return explicit || arrayFrom(data.experiments).find(function (item) {
          return arrayFrom(item.claim_ids).includes(claimRecord.id);
        }) || {};
      });
      const protocolRecords = claimRecords.map(function (claimRecord, index) {
        const experiment = experimentRecords[index] || {};
        return protocols.get(valueFrom(experiment, ["protocol_id", "protocolId"], valueFrom(claimRecord, ["protocol_id", "protocolId"], null))) || {};
      });
      const claimRecord = claimRecords[0] || {};
      const experiment = experimentRecords[0] || {};
      const protocol = protocolRecords[0] || {};
      const variant = variants.get(valueFrom(claimRecord, ["variant_id", "variantId"], valueFrom(experiment, ["variant_id", "variantId"], null))) || {};
      const config = variant.configuration || {};
      if (!Object.keys(protocol).length && !Object.keys(experiment).length) return null;
      const unique = function (values) { return Array.from(new Set(values.filter(Boolean))); };
      const gatePct = numeric(protocol.required_improvement_fraction) === null ? 10 : numeric(protocol.required_improvement_fraction) * 100;
      const anatomy = [
        variant.architecture,
        numeric(variant.parameter_count) === null ? null : Number(variant.parameter_count).toLocaleString() + " parameters",
        config.n_layer ? config.n_layer + " layers" : null,
        config.n_head && config.n_kv_head ? config.n_head + ":" + config.n_kv_head + " Q/KV heads" : null
      ].filter(Boolean).join(" · ");
      const tracedRuns = valueFrom(
        data.summary || {},
        ["traced_evidence_run_count", "tracedEvidenceRunCount", "verified_evidence_run_count", "verified_provenance_count"],
        "Documented"
      );
      if (selectedCorpusId && selectedClaims.length > 1) {
        const modelCells = selectedClaims.map(function (claim) {
          return claim.variantLabel + " — " + statusDisplay(claim.evidenceStatus) + ", " + signedPercent(claim.meanImprovementPct);
        });
        const experimentLabels = unique(experimentRecords.map(function (record) {
          return titleCase(valueFrom(record, ["kind"], "documented validation")) + " · " + valueFrom(record, ["status"], "complete");
        }));
        const metricLabels = selectedClaims.map(function (claim, index) {
          const selectedProtocol = protocolRecords[index] || {};
          return claim.variantLabel + ": " + titleCase(valueFrom(selectedProtocol, ["metric"], "steps_to_ppl_threshold")) + " at PPL ≤ " + valueFrom(selectedProtocol, ["threshold_ppl"], claim.thresholdPpl === null ? 7 : claim.thresholdPpl);
        });
        const protocolLabels = selectedClaims.map(function (claim, index) {
          const selectedProtocol = protocolRecords[index] || {};
          const hashes = arrayFrom(selectedProtocol.protocol_shas).length;
          return claim.variantLabel + ": frozen paired protocol · " + hashes + " traced protocol hash" + (hashes === 1 ? "" : "es");
        });
        return {
          "Corpus": selectedClaim.corpusLabel,
          "Model cells": modelCells.join(" | "),
          "Experiments": experimentLabels.join(" | "),
          "Validation design": selectedClaims.length + " model-specific paired claims; inspect each matrix cell and evidence block for its seeds",
          "Primary metrics": metricLabels.join(" | "),
          "Verification gate": "Each cell independently requires ≥ " + formatNumber(gatePct, 0) + "% versus its documented baseline and all threshold hits",
          "Protocol identities": protocolLabels.join(" | "),
          "Run provenance": tracedRuns + " traced run records in the atlas",
          "Limitations": valueFrom(subject, ["limitations", "caveat", "status_reason"], "Research micro-model evidence; not an official checkpoint claim.")
        };
      }
      return {
        "Corpus": selectedClaim ? selectedClaim.corpusLabel : "Documented corpus",
        "Model variant": selectedClaim ? selectedClaim.variantLabel : valueFrom(variant, ["name", "title"], "Documented model variant"),
        "Experiment": titleCase(valueFrom(experiment, ["kind"], "documented validation")) + " · " + valueFrom(experiment, ["status"], "complete"),
        "Model anatomy": anatomy || "See linked variant record",
        "Validation design": (protocol.held_out ? "Held-out" : "Documented") + " · " + (protocol.paired ? "paired" : "unpaired") + " · minimum " + valueFrom(protocol, ["minimum_seed_count"], 5) + " seeds",
        "Primary metric": titleCase(valueFrom(protocol, ["metric"], "steps_to_ppl_threshold")) + " at PPL ≤ " + valueFrom(protocol, ["threshold_ppl"], 7),
        "Verification gate": "≥ " + formatNumber(gatePct, 0) + "% versus " + (valueFrom(claimRecord.validation || {}, ["baseline_kind"], "fresh_empty") === "inherited_recipe" ? "inherited one-gene parent" : "fresh empty") + "; all threshold hits required",
        "Protocol evidence": (selectedClaim ? selectedClaim.variantLabel : valueFrom(variant, ["name", "title"], "Documented model")) + " · frozen paired protocol · " + arrayFrom(protocol.protocol_shas).length + " traced protocol hash" + (arrayFrom(protocol.protocol_shas).length === 1 ? "" : "es"),
        "Run provenance": tracedRuns + " traced run records in the atlas",
        "Limitations": valueFrom(subject, ["limitations", "caveat", "status_reason"], "Research micro-model evidence; not an official checkpoint claim.")
      };
    }

    function fragmentEvidenceCopy(fragment, evidence, isQkv) {
      const variantIds = Array.from(new Set(evidence.map(function (claim) { return claim.variantId; }).filter(Boolean)));
      const corpusIds = Array.from(new Set(evidence.map(function (claim) { return claim.corpusId; }).filter(Boolean)));
      const cellCount = new Set(evidence.map(function (claim) {
        return claim.variantId + "\u0000" + claim.corpusId;
      })).size;
      const verifiedCount = evidence.filter(function (claim) { return claim.evidenceStatus === "verified"; }).length;
      const primary = evidence[0] || {};
      const sibling = evidence.find(function (claim) {
        return claim.corpusId === primary.corpusId && claim.variantId !== primary.variantId;
      });
      let summary;
      let secondary;
      let evidenceTag;
      if (isQkv) {
        summary = "An atomic candidate that normalizes the fused attention QKV tensor after the inherited scale gene.";
        secondary = evidence.length ? primary.pairedWins + "/" + primary.pairedRuns + " positive seeds · " + primary.corpusLabel : "No performance claim";
        evidenceTag = "inherited-baseline probe";
      } else if (corpusIds.length > 1) {
        const modelLabel = variantIds.length === 1 ? valueFrom(primary, ["variantLabel"], "one compatible model") : variantIds.length + " compatible models";
        summary = "A portable single-gene scale transform measured on " + modelLabel + " across " + corpusIds.length + " registered corpora under corpus-specific evidence contracts.";
        secondary = cellCount + " measured model × corpus cell" + (cellCount === 1 ? "" : "s") + " · " + verifiedCount + " verified";
        evidenceTag = corpusIds.length + "-corpus evidence";
      } else if (variantIds.length > 1 && sibling) {
        summary = "A portable single-gene scale transform discovered from empty DNA and transferred unchanged within the proxy lineage.";
        secondary = formatNumber(sibling.meanImprovementPct, 2) + "% after unchanged sibling transfer · " + sibling.variantLabel;
        evidenceTag = "unchanged sibling transfer";
      } else {
        summary = "A portable single-gene scale transform measured against its documented baseline on a compatible proxy model.";
        secondary = evidence.length ? primary.pairedWins + "/" + primary.pairedRuns + " positive seeds · " + primary.corpusLabel : "No performance claim";
        evidenceTag = "single-model evidence";
      }
      return {
        summary: summary,
        secondary: secondary,
        tags: evidence.length ? [primary.pairedRuns + "-seed", evidenceTag, verifiedCount + "/" + evidence.length + " verified cells"] : []
      };
    }

    variants.forEach(function (variant) {
      if (variant.catalog_card !== true) return;
      const family = familyFor(variant);
      const config = variant.configuration || {};
      const contract = variant.architecture_contract || {};
      const parameterCount = numeric(variant.parameter_count);
      const runtimeStatus = valueFrom(variant, ["runtime_status", "runtimeStatus"], "runnable");
      const attention = valueFrom(contract, ["attention"], titleCase(variant.architecture));
      const feedForward = valueFrom(contract, ["feed_forward", "feedForward"], "family-specific feed-forward");
      const modelBits = [
        config.n_layer ? config.n_layer + " layers" : null,
        config.n_embd ? "d=" + config.n_embd : null,
        "vocab " + valueFrom(config, ["vocab_size"], 257),
        "context " + valueFrom(config, ["block_size"], 256)
      ].filter(Boolean);
      entries.push({
        id: variant.id,
        kind: "model",
        family: familyLabel(family, variant.name),
        familyKey: valueFrom(family, ["key", "slug", "id"], variant.family_id),
        title: variant.name,
        status: valueFrom(variant, ["dna_evidence_status", "evidence_status"], "none"),
        availability: valueFrom(variant, ["availability"], "runnable"),
        runtimeStatus: runtimeStatus,
        statusReason: "The runtime smoke completed construction, CUDA training/evaluation, checkpoint config, and generation. No initialization-DNA search or optimization-effect validation has been run for this lineage.",
        summary: attention + ". " + feedForward + ".",
        target: "model profile",
        op: "runnable",
        value: null,
        tags: [runtimeStatus + " runtime", config.n_layer + " layers", "DNA untested"],
        payload: config,
        headline: null,
        modelMetric: {
          value: parameterCount,
          label: "measured parameters; not an effect metric"
        },
        secondaryMetric: modelBits.join(" · "),
        evidence: [],
        matrixRows: [],
        corpusLabels: [],
        variantLabels: [variant.name],
        jointScalingEvidence: null,
        widthScalingEvidence: null,
        passport: {
          "Runtime availability": titleCase(runtimeStatus) + " on the project CUDA training path",
          "DNA evidence": "None — no convergence-efficiency claim",
          "Measured parameters": parameterCount === null ? "Pending measurement" : Number(parameterCount).toLocaleString(),
          "Architecture": variant.architecture,
          "Attention": attention,
          "Feed-forward": feedForward,
          "Implementation": valueFrom(variant, ["implementation"], "model/family_mini.py"),
          "Scope": variant.disclaimer
        },
        evidenceUrl: valueFrom(variant, ["official_source_url", "source_url"], null),
        sourceLinkLabel: "Open official architecture source"
      });
    });

    fragments.forEach(function (fragment) {
      const family = familyFor(fragment);
      const evidence = claimsFor(fragment, "fragment");
      const primary = evidence[0] || {};
      const payload = payloadFromFragment(fragment);
      const gene = payload && payload.genes ? payload.genes[0] || {} : {};
      const improvement = numeric(valueFrom(fragment, ["headline_value", "headlineValue"], primary.meanImprovementPct));
      const isQkv = String(fragment.id).includes("qkv");
      const status = valueFrom(fragment, ["status", "evidence_status", "verification_status"], "experimental");
      const evidenceCopy = fragmentEvidenceCopy(fragment, evidence, isQkv);
      const matrixRows = matrixFor(
        fragment,
        evidence,
        ["compatible_variant_ids", "compatibleVariantIds"]
      );
      entries.push({
        id: fragment.id,
        kind: "gene",
        family: familyLabel(family, valueFrom(fragment, ["family", "family_label"], "Unknown family")),
        familyKey: valueFrom(family, ["key", "slug", "id"], valueFrom(fragment, ["family_key", "familyKey"], "unknown")),
        title: valueFrom(fragment, ["title", "name", "label"], fragment.id),
        status: status,
        statusReason: valueFrom(fragment, ["status_reason", "statusReason", "verification_note"], status === "verified" ? "Passed the 10% fresh-empty verification gate on held-out paired seeds." : "The available signal has not passed the standalone verification gate."),
        summary: valueFrom(fragment, ["summary", "description"], evidenceCopy.summary),
        target: valueFrom(fragment, ["target", "selector"], gene.target || "TBD"),
        op: valueFrom(fragment, ["op", "operation"], gene.op || "TBD"),
        value: valueFrom(fragment, ["value", "parameter"], gene.value),
        tags: arrayFrom(valueFrom(fragment, ["tags", "labels"], evidenceCopy.tags)),
        payload: payload,
        headline: improvement === null ? null : {
          value: improvement,
          unit: "%",
          label: valueFrom(
            fragment,
            ["headline_label", "headlineLabel"],
            "mean step improvement · " + valueFrom(primary, ["corpusLabel"], LEGACY_CORPUS.label)
          )
        },
        secondaryMetric: valueFrom(fragment, ["secondary_metric", "secondaryMetric"], evidenceCopy.secondary),
        evidence: evidence,
        matrixRows: matrixRows,
        corpusLabels: corpusRecords.map(function (corpus) { return corpus.label; }),
        variantLabels: matrixRows.map(function (row) { return row.variantLabel; }),
        jointScalingEvidence: normalizeJointScalingEvidence(valueFrom(fragment, ["joint_scaling_evidence", "jointScalingEvidence"], null)),
        widthScalingEvidence: normalizeWidthScalingEvidence(valueFrom(fragment, ["width_scaling_evidence", "widthScalingEvidence"], null), corpora),
        assurancePassport: assurancePassportFor(fragment, evidence),
        passport: passportFor(fragment, evidence, null),
        passportForCorpus: function (corpusId) { return passportFor(fragment, evidence, corpusId); },
        evidenceLinks: evidenceLinksFor(fragment, evidence)
      });
    });

    recipes.forEach(function (recipe) {
      if (arrayFrom(valueFrom(recipe, ["fragment_ids", "fragmentIds"], [])).length < 2) return;
      const family = familyFor(recipe);
      const evidence = claimsFor(recipe, "recipe");
      const primary = evidence[0] || {};
      let payload = valueFrom(recipe, ["payload", "dna"], null);
      if (!payload) {
        const fragmentMap = new Map(fragments.map(function (fragment) { return [fragment.id, fragment]; }));
        const genes = arrayFrom(valueFrom(recipe, ["fragment_ids", "fragmentIds"], [])).flatMap(function (id) {
          const fragmentPayload = payloadFromFragment(fragmentMap.get(id) || {});
          return fragmentPayload && Array.isArray(fragmentPayload.genes) ? fragmentPayload.genes : [];
        });
        payload = genes.length ? { genes: genes } : null;
      }
      const genes = payload && Array.isArray(payload.genes) ? payload.genes : [];
      const improvement = numeric(valueFrom(recipe, ["headline_value", "headlineValue"], primary.meanImprovementPct));
      const matrixRows = matrixFor(recipe, evidence, ["variant_ids", "variantIds"]);
      entries.push({
        id: recipe.id,
        kind: "recipe",
        family: familyLabel(family, valueFrom(recipe, ["family", "family_label"], "Unknown family")),
        familyKey: valueFrom(family, ["key", "slug", "id"], valueFrom(recipe, ["family_key", "familyKey"], "unknown")),
        title: valueFrom(recipe, ["title", "name", "label"], recipe.id),
        status: valueFrom(recipe, ["status", "evidence_status", "verification_status"], "experimental"),
        statusReason: valueFrom(recipe, ["status_reason", "statusReason", "verification_note"], "The ordered recipe is evaluated against its registered baseline on held-out paired seeds; inspect the claim gate for its measured status."),
        summary: valueFrom(recipe, ["summary", "description"], "An ordered multi-gene recipe evaluated under its registered lineage protocol."),
        target: valueFrom(recipe, ["target", "target_summary"], genes.map(function (gene) { return gene.target; }).filter(Boolean).join(" + ") || "TBD"),
        op: valueFrom(recipe, ["op", "operation_summary"], genes.map(function (gene) { return gene.op; }).filter(Boolean).join(" → ") || "TBD"),
        value: null,
        tags: arrayFrom(valueFrom(recipe, ["tags", "labels"], [genes.length + "-gene recipe", primary.pairedRuns + "-seed", "lineage recipe"])),
        payload: payload,
        headline: improvement === null ? null : {
          value: improvement,
          unit: "%",
          label: valueFrom(
            recipe,
            ["headline_label", "headlineLabel"],
            "mean step improvement · " + valueFrom(primary, ["corpusLabel"], LEGACY_CORPUS.label)
          )
        },
        secondaryMetric: valueFrom(recipe, ["secondary_metric", "secondaryMetric"], evidence.length ? formatNumber(primary.candidateMeanSteps, 2) + " mean steps vs " + formatNumber(primary.baselineMeanSteps, 2) + " baseline · " + primary.corpusLabel : "No performance claim"),
        evidence: evidence,
        matrixRows: matrixRows,
        corpusLabels: corpusRecords.map(function (corpus) { return corpus.label; }),
        variantLabels: matrixRows.map(function (row) { return row.variantLabel; }),
        jointScalingEvidence: null,
        widthScalingEvidence: normalizeWidthScalingEvidence(valueFrom(recipe, ["width_scaling_evidence", "widthScalingEvidence"], null), corpora),
        assurancePassport: assurancePassportFor(recipe, evidence),
        passport: passportFor(recipe, evidence, null),
        passportForCorpus: function (corpusId) { return passportFor(recipe, evidence, corpusId); },
        evidenceLinks: evidenceLinksFor(recipe, evidence)
      });
    });

    const representedFamilies = new Set(entries.map(function (entry) { return entry.family; }));
    families.forEach(function (family) {
      const familyName = familyLabel(family, family.id);
      const status = valueFrom(family, ["status", "evidence_status"], "planned");
      if (status === "planned" && !representedFamilies.has(familyName)) {
        entries.push({
          id: family.id + "-lineage",
          kind: "lineage",
          family: familyName,
          familyKey: valueFrom(family, ["key", "slug", "id"], family.id),
          title: familyName + " lineage",
          status: "planned",
          statusReason: valueFrom(family, ["status_reason", "statusReason"], "No clean-room search or paired validation has been completed in this Atlas yet."),
          summary: valueFrom(family, ["summary", "description"], "A future proxy lineage for independent discovery, sibling transfer, and five-seed verification."),
          target: "TBD",
          op: "TBD",
          value: null,
          tags: ["roadmap"],
          payload: null,
          headline: null,
          secondaryMetric: "No performance claim",
          evidence: [],
          matrixRows: [],
          corpusLabels: [],
          variantLabels: [],
          jointScalingEvidence: null,
          widthScalingEvidence: null,
          passport: null,
          evidenceUrl: null
        });
      }
    });

    return entries;
  }

  function normalizeCatalog(data) {
    const entries = Array.isArray(data.entries) ? data.entries : relationalEntries(data);
    return entries.map(function (entry) {
      const normalized = Object.assign({
        kind: "gene",
        family: "Unknown family",
        familyKey: "unknown",
        status: "experimental",
        statusReason: "Evidence status not documented.",
        summary: "",
        target: "TBD",
        op: "TBD",
        tags: [],
        payload: null,
        headline: null,
        modelMetric: null,
        secondaryMetric: "No performance claim",
        evidence: [],
        matrixRows: [],
        corpusLabels: [],
        variantLabels: [],
        jointScalingEvidence: null,
        widthScalingEvidence: null,
        assurancePassport: null,
        passport: null,
        evidenceUrl: null,
        sourceLinkLabel: null
      }, entry, { status: String(entry.status || "experimental").toLowerCase() });
      normalized.assurancePassport = normalizeAssurancePassport(
        valueFrom(entry, ["assurance_passport", "assurancePassport"], null)
      );
      return normalized;
    });
  }

  function fillSelect(select, values, preferredOrder) {
    const placeholder = select.options[0];
    select.replaceChildren(placeholder);
    const unique = Array.from(new Set(values.filter(Boolean)));
    unique.sort(function (a, b) {
      if (preferredOrder) return preferredOrder.indexOf(a) - preferredOrder.indexOf(b);
      return String(a).localeCompare(String(b));
    });
    unique.forEach(function (value) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value === "none" ? "DNA untested" : titleCase(value);
      select.appendChild(option);
    });
  }

  function initializeFilters() {
    fillSelect(familyFilter, state.entries.map(function (entry) { return entry.family; }));
    const corpusPlaceholder = corpusFilter.options[0];
    corpusFilter.replaceChildren(corpusPlaceholder);
    state.corpora.forEach(function (corpus) {
      const option = document.createElement("option");
      option.value = corpus.id;
      option.textContent = valueFrom(corpus, ["label", "name"], corpus.id);
      corpusFilter.appendChild(option);
    });
    fillSelect(statusFilter, state.entries.map(function (entry) { return entry.status; }), STATUS_ORDER);
    fillSelect(targetFilter, state.entries.map(function (entry) { return entry.target; }));
    fillSelect(opFilter, state.entries.map(function (entry) { return entry.op; }));
  }

  function setText(element, value) {
    if (element && value !== null && value !== undefined) element.textContent = String(value);
  }

  function updateSummary(data) {
    const summary = data.summary || {};
    const families = arrayFrom(data.families);
    const runnableFamilies = numeric(valueFrom(summary, ["runnable_family_count", "available_family_count", "availableFamilyCount"], null));
    const runnableTotal = runnableFamilies === null
      ? families.filter(function (family) { return valueFrom(family, ["availability"], "planned") === "runnable"; }).length
      : runnableFamilies;
    const evidenceFamilies = numeric(valueFrom(summary, ["evidence_family_count", "evidenceFamilyCount"], null));
    const evidenceTotal = evidenceFamilies === null
      ? families.filter(function (family) { return arrayFrom(family.fragment_ids).length > 0; }).length
      : evidenceFamilies;
    const verifiedGenes = state.entries.filter(function (entry) { return entry.kind === "gene" && entry.status === "verified"; }).length;
    const verifiedMultiGeneRecipes = state.entries.filter(function (entry) {
      const genes = entry.payload && Array.isArray(entry.payload.genes) ? entry.payload.genes : [];
      return entry.kind === "recipe" && entry.status === "verified" && genes.length >= 2;
    }).length;
    const experimentalRecords = state.entries.filter(function (entry) { return entry.status === "experimental"; }).length;
    const gate = valueFrom(data.project || {}, ["verification_gate", "verificationGate"], {});
    let gatePercent = numeric(valueFrom(gate, ["minimumImprovementPct", "minimum_improvement_percent"], null));
    if (gatePercent === null && numeric(gate.minimum_improvement_fraction) !== null) gatePercent = numeric(gate.minimum_improvement_fraction) * 100;
    const minimumSeeds = numeric(valueFrom(gate, ["minimum_seed_count", "pairedSeedsRequired"], null));
    const tracedRuns = numeric(valueFrom(summary, ["traced_evidence_run_count", "tracedEvidenceRunCount", "verified_evidence_run_count", "verifiedEvidenceRunCount", "verified_provenance_count", "verifiedProvenanceCount"], null));

    setText(runnableLineageCount, runnableTotal);
    setText(evidenceLineageCount, evidenceTotal + " evidence lineage" + (evidenceTotal === 1 ? "" : "s"));
    setText(verifiedGeneCount, verifiedGenes);
    setText(verifiedRecipeCount, verifiedMultiGeneRecipes);
    setText(experimentalCount, experimentalRecords);
    if (gatePercent !== null) setText(verificationGateValue, formatNumber(gatePercent, gatePercent % 1 ? 1 : 0));
    if (minimumSeeds !== null) setText(minimumSeedCount, minimumSeeds);
    if (tracedRuns !== null) setText(provenanceRunCount, tracedRuns);
  }

  function searchable(entry) {
    const joint = entry.jointScalingEvidence;
    return [entry.title, entry.family, entry.summary, entry.target, entry.op, entry.status, entry.kind]
      .concat(entry.tags || [])
      .concat(entry.corpusLabels || [])
      .concat(entry.variantLabels || [])
      .concat(joint ? [joint.studyId] : [])
      .concat(joint ? joint.corpora.flatMap(function (corpus) { return [corpus.label, corpus.sourceLabel]; }) : [])
      .concat(joint ? joint.profiles.map(function (profile) { return profile.label; }) : [])
      .concat((entry.evidence || []).flatMap(function (claim) {
        return [claim.label, claim.model, claim.variantLabel, claim.corpusLabel];
      }))
      .join(" ")
      .toLowerCase();
  }

  function claimsForCorpus(entry, corpusId) {
    const matrixClaims = (entry.matrixRows || []).flatMap(function (row) {
      return row.cells.map(function (cell) { return cell.claim; }).filter(Boolean);
    });
    if (!corpusId) return matrixClaims;
    return matrixClaims.filter(function (claim) { return claim.corpusId === corpusId; });
  }

  function entryStatusForCorpus(entry, corpusId) {
    if (!corpusId || entry.kind === "model") return entry.status;
    const claims = claimsForCorpus(entry, corpusId);
    if (!claims.length) return "none";
    const compatibleCount = (entry.matrixRows || []).length;
    if (claims.length === compatibleCount && claims.every(function (claim) {
      return claim.evidenceStatus === "verified";
    })) return "verified";
    return "experimental";
  }

  function entryView(entry) {
    const corpusId = corpusFilter.value;
    if (!corpusId || entry.kind === "model") {
      return {
        status: entry.status,
        headline: entry.headline,
        modelMetric: entry.modelMetric,
        coverageMetric: null,
        pendingTitle: "Pending",
        pendingLabel: "no measured result has been claimed",
        secondaryMetric: entry.secondaryMetric,
        statusReason: entry.statusReason,
        tags: entry.tags || []
      };
    }
    const persistentTags = arrayFrom(entry.tags).filter(function (tag) {
      return tag === "原生基因";
    });
    const contextualTags = function (tags) {
      return Array.from(new Set(persistentTags.concat(tags)));
    };
    const corpus = state.corporaById.get(corpusId) || {};
    const corpusLabel = valueFrom(corpus, ["label", "name"], corpusId);
    const claims = claimsForCorpus(entry, corpusId);
    const compatibleCount = (entry.matrixRows || []).length;
    if (!claims.length) {
      return {
        status: "none",
        headline: null,
        modelMetric: null,
        coverageMetric: null,
        pendingTitle: "Untested",
        pendingLabel: "no model × corpus effect has been measured",
        secondaryMetric: corpusLabel + " · no claim",
        statusReason: "No paired claim exists for this DNA on " + corpusLabel + ". Untested is not a zero effect.",
        tags: contextualTags([corpusLabel, "Untested"])
      };
    }
    const status = entryStatusForCorpus(entry, corpusId);
    const verifiedCount = claims.filter(function (claim) {
      return claim.evidenceStatus === "verified";
    }).length;
    if (compatibleCount > 1) {
      return {
        status: status,
        headline: null,
        modelMetric: null,
        coverageMetric: {
          value: claims.length + "/" + compatibleCount,
          label: "compatible model cells measured"
        },
        pendingTitle: "Untested",
        pendingLabel: "no model × corpus effect has been measured",
        secondaryMetric: corpusLabel + " · " + verifiedCount + " verified cell" + (verifiedCount === 1 ? "" : "s"),
        statusReason: claims.length + " of " + compatibleCount + " compatible model cells have measured evidence on " + corpusLabel + ".",
        tags: contextualTags([corpusLabel, claims.length + " measured cells"])
      };
    }
    const claim = claims[0];
    return {
      status: status,
      headline: {
        value: claim.meanImprovementPct,
        unit: "%",
        label: "mean step improvement on selected corpus"
      },
      modelMetric: null,
      coverageMetric: null,
      pendingTitle: "Untested",
      pendingLabel: "no model × corpus effect has been measured",
      secondaryMetric: corpusLabel + " · " + claim.pairedWins + "/" + claim.pairedRuns + " positive seeds",
      statusReason: claim.label + " on " + corpusLabel + ".",
      tags: contextualTags([corpusLabel, claim.variantLabel, claim.evidenceStatus])
    };
  }

  function applyFilters() {
    const query = searchInput.value.trim().toLowerCase();
    const corpusId = corpusFilter.value;
    state.visible = state.entries.filter(function (entry) {
      const contextualStatus = entryStatusForCorpus(entry, corpusId);
      return (!query || searchable(entry).includes(query)) &&
        (!familyFilter.value || entry.family === familyFilter.value) &&
        (!corpusId || (entry.kind !== "model" && (entry.matrixRows || []).length > 0)) &&
        (!statusFilter.value || contextualStatus === statusFilter.value) &&
        (!targetFilter.value || entry.target === targetFilter.value) &&
        (!opFilter.value || entry.op === opFilter.value);
    });
    renderCards();
  }

  function geneLine(entry) {
    if (entry.kind === "model") return entry.id + " · runnable · DNA untested";
    if (entry.kind === "lineage") return "Target and operation to be discovered";
    const value = entry.value === null || entry.value === undefined ? "" : " · " + entry.value;
    return entry.target + " · " + entry.op + value;
  }

  function statusDisplay(status) {
    return status === "none" ? "DNA untested" : titleCase(status);
  }

  function cardTemplate(entry) {
    const view = entryView(entry);
    const status = escapeHTML(view.status);
    const metric = entry.kind === "model" && view.modelMetric
      ? '<div class="metric metric-model"><strong>' + escapeHTML(Number(view.modelMetric.value).toLocaleString()) + '</strong><span>' + escapeHTML(view.modelMetric.label) + "</span></div>"
      : view.coverageMetric
      ? '<div class="metric metric-model"><strong>' + escapeHTML(view.coverageMetric.value) + '</strong><span>' + escapeHTML(view.coverageMetric.label) + "</span></div>"
      : view.headline
      ? '<div class="metric"><strong>' + escapeHTML(formatNumber(view.headline.value, 2)) + escapeHTML(view.headline.unit || "") + '</strong><span>' + escapeHTML(view.headline.label) + "</span></div>"
      : '<div class="metric metric-pending"><strong>' + escapeHTML(view.pendingTitle) + '</strong><span>' + escapeHTML(view.pendingLabel) + "</span></div>";
    const tags = (view.tags || []).slice(0, 3).map(function (tag) { return "<span>" + escapeHTML(tag) + "</span>"; }).join("");
    const assuranceItems = entry.assurancePassport ? entry.assurancePassport.items : [];
    const assuranceFlags = assuranceItems.filter(function (item) {
      return item.status === "failed" || item.status === "not-applicable";
    });
    const assuranceScopeLabel = entry.assurancePassport
      && entry.assurancePassport.schemaVersion === "derived-from-catalog-claims"
      ? "measured claims · legacy stages only when recorded"
      : "controls · breeding · ablations";
    const assuranceBadge = entry.kind === "model" || !assuranceItems.length ? "" :
      '<p class="card-assurance"><strong>' + escapeHTML(assuranceItems.length) + ' recorded checks</strong> <span>' + escapeHTML(assuranceScopeLabel) +
      (assuranceFlags.length ? " · " + assuranceFlags.length + " failed or unperformed visible" : "") + '</span></p>';
    const copyDisabled = entry.payload ? "" : " disabled";
    const detailLabel = entry.kind === "model" ? "Model details" : "Evidence details";
    const copyLabel = entry.kind === "model" ? "Copy config" : "Copy JSON";
    return '<article class="gene-card" data-kind="' + escapeHTML(entry.kind) + '" data-status="' + status + '">' +
      '<div class="card-topline"><span class="status status-' + status + '">' + escapeHTML(statusDisplay(view.status)) + "</span><span>" + escapeHTML(entry.family) + "</span></div>" +
      "<h3>" + escapeHTML(entry.title) + "</h3>" +
      "<p>" + escapeHTML(entry.summary) + "</p>" +
      "<code>" + escapeHTML(geneLine(entry)) + "</code>" +
      metric +
      '<p class="card-secondary">' + escapeHTML(view.secondaryMetric) + "</p>" +
      '<div class="card-tags">' + tags + "</div>" +
      assuranceBadge +
      '<div class="card-actions"><button class="card-button" type="button" data-detail-id="' + escapeHTML(entry.id) + '">' + detailLabel + '</button>' +
      '<button class="card-button secondary" type="button" data-copy-id="' + escapeHTML(entry.id) + '"' + copyDisabled + ">" + copyLabel + "</button></div>" +
      "</article>";
  }

  function renderCards() {
    grid.setAttribute("aria-busy", "false");
    if (!state.visible.length) {
      grid.innerHTML = '<div class="empty-state"><h3>No atlas record matches.</h3><p>Widen a filter or reset the query. Runnable model profiles and DNA evidence use separate statuses.</p></div>';
    } else {
      grid.innerHTML = state.visible.map(cardTemplate).join("");
    }
    resultCount.textContent = state.visible.length + " of " + state.entries.length + " records shown";
  }

  function chartTemplate(seeds) {
    if (!seeds.length) return "";
    const max = Math.max.apply(null, seeds.map(function (row) { return Math.abs(row.improvementPct || 0); }).concat([1]));
    const bars = seeds.map(function (row) {
      const height = 8 + (Math.abs(row.improvementPct || 0) / max) * 82;
      const negative = row.improvementPct < 0;
      return '<div class="seed-bar-wrap"><span class="seed-bar-value">' + escapeHTML(formatNumber(row.improvementPct, 1)) + '%</span>' +
        '<span class="seed-bar' + (negative ? " negative" : "") + '" style="height:' + height.toFixed(1) + '%"></span>' +
        '<span class="seed-bar-label">' + escapeHTML(row.seed) + "</span></div>";
    }).join("");
    return '<div class="seed-chart" role="img" aria-label="Per-seed relative improvement chart; amber marks a regression">' + bars + "</div>";
  }

  function tableTemplate(seeds) {
    if (!seeds.length) return '<p>No per-seed table is available for this planned record.</p>';
    const rows = seeds.map(function (row) {
      const resultClass = row.improvementPct < 0 ? "negative-text" : "positive";
      return "<tr><td>" + escapeHTML(row.seed) + "</td><td>" + escapeHTML(formatNumber(row.baselineSteps, 2)) + "</td><td>" + escapeHTML(formatNumber(row.candidateSteps, 2)) + '</td><td class="' + resultClass + '">' + escapeHTML(formatNumber(row.improvementPct, 2)) + "%</td></tr>";
    }).join("");
    return '<div class="seed-table-wrap"><table class="seed-table"><thead><tr><th>Seed</th><th>Baseline step</th><th>DNA step</th><th>Improvement</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }

  function compactTokens(value) {
    const tokens = numeric(value);
    if (tokens === null) return "—";
    if (tokens >= 1e6) return formatNumber(tokens / 1e6, tokens >= 1e7 ? 1 : 2) + "M";
    if (tokens >= 1e3) return formatNumber(tokens / 1e3, 0) + "K";
    return formatNumber(tokens, 0);
  }

  function fixedAnchorTokens(value) {
    const tokens = numeric(value);
    if (tokens === null) return "—";
    return formatNumber(tokens / 1e6, 4) + "M";
  }

  function curveCoordinateLabel(curve) {
    return [
      curve.parameterCount === null ? null : Number(curve.parameterCount).toLocaleString() + " parameters",
      curve.corpusTokens === null ? null : Number(curve.corpusTokens).toLocaleString() + " prefix tokens",
      curve.transitionTokens === null ? null : Number(curve.transitionTokens).toLocaleString() + " transitions"
    ].filter(Boolean).join(" · ");
  }

  function convergenceDataTable(curve) {
    if (curve.mode === "lineage") {
      const headers = curve.armKeys.map(function (key) {
        return "<th>" + escapeHTML(LINEAGE_ARM_LABELS[key] || titleCase(key)) + " PPL · range</th>";
      }).join("") + curve.ratioKeys.map(function (key) {
        return "<th>" + escapeHTML(LINEAGE_RATIO_LABELS[key] || titleCase(key)) + " · range</th>";
      }).join("");
      const rows = curve.points.map(function (point) {
        const arms = curve.armKeys.map(function (key) {
          const arm = point.arms[key];
          return "<td>" + escapeHTML(formatNumber(arm.geometricMeanPpl, 3)) + " <small>[" +
            escapeHTML(formatNumber(arm.minPpl, 3)) + "–" + escapeHTML(formatNumber(arm.maxPpl, 3)) + "]</small></td>";
        }).join("");
        const ratios = curve.ratioKeys.map(function (key) {
          const ratio = point.pairedRatios[key];
          return "<td>" + escapeHTML(formatNumber(ratio.geometricMean, 3)) + " <small>[" +
            escapeHTML(formatNumber(ratio.min, 3)) + "–" + escapeHTML(formatNumber(ratio.max, 3)) + "]</small></td>";
        }).join("");
        return "<tr><td>" + escapeHTML(point.step) + "</td><td>" + escapeHTML(compactTokens(point.trainingTokens)) + "</td>" + arms + ratios + "</tr>";
      }).join("");
      return '<details class="ppl-curve-data lineage-curve-data"><summary>Read all ' + escapeHTML(curve.points.length) +
        ' checkpoint values</summary><div class="ppl-curve-table-wrap"><table><thead><tr><th>Step</th><th>Tokens</th>' +
        headers + "</tr></thead><tbody>" + rows + "</tbody></table></div></details>";
    }
    const rows = curve.points.map(function (point) {
      return "<tr><td>" + escapeHTML(point.step) + "</td><td>" + escapeHTML(compactTokens(point.trainingTokens)) +
        "</td><td>" + escapeHTML(formatNumber(point.empty.geometricMeanPpl, 3)) + " <small>[" +
        escapeHTML(formatNumber(point.empty.minPpl, 3)) + "–" + escapeHTML(formatNumber(point.empty.maxPpl, 3)) +
        "]</small></td><td>" + escapeHTML(formatNumber(point.gene.geometricMeanPpl, 3)) + " <small>[" +
        escapeHTML(formatNumber(point.gene.minPpl, 3)) + "–" + escapeHTML(formatNumber(point.gene.maxPpl, 3)) +
        "]</small></td><td>" + escapeHTML(formatNumber(point.ratio.geometricMean, 3)) + " <small>[" +
        escapeHTML(formatNumber(point.ratio.min, 3)) + "–" + escapeHTML(formatNumber(point.ratio.max, 3)) +
        "]</small></td></tr>";
    }).join("");
    return '<details class="ppl-curve-data"><summary>Read all ' + escapeHTML(curve.points.length) + ' checkpoint values</summary><div class="ppl-curve-table-wrap"><table><thead><tr><th>Step</th><th>Tokens</th><th>Empty PPL · range</th><th>DNA PPL · range</th><th>DNA / empty · range</th></tr></thead><tbody>' + rows + "</tbody></table></div></details>";
  }

  function convergenceCurveTemplate(claim, showCurve) {
    const curve = showCurve === false ? null : claim.convergenceCurve;
    if (!curve) return "";
    if (curve.mode === "lineage") {
      const isEvolution = curve.armKeys.includes("selected_offspring");
      const first = curve.points[0];
      const last = curve.points[curve.points.length - 1];
      const primaryRatioKey = !isEvolution
        ? "inherited_native_to_fresh_empty"
        : claim.baselineKind === "fresh_empty"
        ? "selected_offspring_to_fresh_empty"
        : "selected_offspring_to_inherited_native";
      const primaryRatio = last.pairedRatios[primaryRatioKey] || last.pairedRatios[curve.ratioKeys[0]];
      const favorable = curve.points.filter(function (point) {
        const ratio = point.pairedRatios[primaryRatioKey] || point.pairedRatios[curve.ratioKeys[0]];
        return ratio && ratio.geometricMean < 1;
      }).length;
      const summaryId = "ppl-summary-" + claim.id;
      const liveId = "ppl-live-" + claim.id;
      const coordinate = curveCoordinateLabel(curve);
      const title = isEvolution ? "One-generation selected-candidate PPL convergence" : "Same-lineage transfer PPL convergence";
      const subtitle = coordinate || "Exact measured model and corpus coordinates";
      const primaryRatioLabel = LINEAGE_RATIO_LABELS[primaryRatioKey] || titleCase(primaryRatioKey);
      const summary = primaryRatioLabel +
        " geometric-mean PPL is below 1.0 at <strong>" + escapeHTML(favorable) + "/" + escapeHTML(curve.points.length) +
        "</strong> checkpoints and ends at <strong>" + escapeHTML(formatNumber(primaryRatio.geometricMean, 3)) +
        "</strong>. Bands are observed five-seed minima and maxima, not confidence intervals.";
      const legends = curve.armKeys.map(function (key) {
        return '<span class="legend-lineage-' + escapeHTML(key.replaceAll("_", "-")) + '">' + escapeHTML(LINEAGE_ARM_LABELS[key] || titleCase(key)) + "</span>";
      }).join("") + curve.ratioKeys.map(function (key) {
        return '<span class="legend-ratio-' + escapeHTML(key.replaceAll("_", "-")) + '">' + escapeHTML(LINEAGE_RATIO_LABELS[key] || titleCase(key)) + " ratio</span>";
      }).join("") + '<span class="legend-threshold">Frozen threshold</span><span class="legend-range">5-seed range</span>';
      const ariaArms = curve.armKeys.map(function (key) { return LINEAGE_ARM_LABELS[key] || titleCase(key); }).join(", ");
      const ariaLabel = title + " for " + (coordinate || claim.corpusLabel) + ". Arms: " + ariaArms +
        ". The lower panel shows paired PPL ratios; values below one favor the numerator. Final primary ratio " +
        formatNumber(primaryRatio.geometricMean, 3) + ".";
      return '<figure class="ppl-curve lineage-curve' + (isEvolution ? " lineage-evolution" : " lineage-transfer") +
        '" data-curve-claim-id="' + escapeHTML(claim.id) + '"><figcaption><strong>' + escapeHTML(title) +
        "</strong><span>" + escapeHTML(subtitle) + "</span></figcaption><p class=\"ppl-curve-summary\" id=\"" +
        escapeHTML(summaryId) + '\">' + summary + '</p><div class="ppl-curve-legend lineage-curve-legend" aria-hidden="true">' + legends +
        '</div><div class="ppl-canvas-wrap"><canvas class="ppl-curve-canvas lineage-curve-canvas" width="960" height="440" tabindex="0" role="img" aria-label="' +
        escapeHTML(ariaLabel) + '" aria-describedby="' + escapeHTML(summaryId) + " " + escapeHTML(liveId) +
        '" aria-keyshortcuts="ArrowLeft ArrowRight Home End"></canvas><div class="ppl-curve-tooltip lineage-curve-tooltip" hidden></div></div>' +
        '<output class="sr-only" id="' + escapeHTML(liveId) + '" aria-live="polite"></output>' + convergenceDataTable(curve) + "</figure>";
    }
    const first = curve.points[0];
    const last = curve.points[curve.points.length - 1];
    const belowCount = curve.points.filter(function (point) {
      return point.gene.geometricMeanPpl < point.empty.geometricMeanPpl;
    }).length;
    const allSeedBelowCount = curve.points.filter(function (point) {
      return point.ratio.max < 1;
    }).length;
    const summaryId = "ppl-summary-" + claim.id;
    const liveId = "ppl-live-" + claim.id;
    const coordinate = curveCoordinateLabel(curve);
    const earlyGap = (1 - first.ratio.geometricMean) * 100;
    const finalGap = (1 - last.ratio.geometricMean) * 100;
    const ariaLabel = "Validation PPL convergence for " + (coordinate || claim.corpusLabel) + ". DNA geometric-mean PPL is below the empty geometric mean at " + belowCount + " of " + curve.points.length + " within-run checkpoints. All five paired seeds are lower at " + allSeedBelowCount + " checkpoints. Paired DNA to empty PPL ratio changes from " + formatNumber(first.ratio.geometricMean, 3) + " to " + formatNumber(last.ratio.geometricMean, 3) + ".";
    return '<figure class="ppl-curve" data-curve-claim-id="' + escapeHTML(claim.id) + '"><figcaption><strong>Validation PPL convergence</strong><span>' + escapeHTML(coordinate || "Fixed-size training trajectory · not a model-size scaling law") + '</span></figcaption>' +
      '<p class="ppl-curve-summary" id="' + escapeHTML(summaryId) + '">DNA geometric-mean PPL is below the empty geometric mean at <strong>' + escapeHTML(belowCount) + "/" + escapeHTML(curve.points.length) + "</strong> within-run checkpoints; all five paired seeds are lower at <strong>" + escapeHTML(allSeedBelowCount) + "/" + escapeHTML(curve.points.length) + "</strong>. The mean PPL gap narrows from <strong>" + escapeHTML(formatNumber(earlyGap, 1)) + "%</strong> to <strong>" + escapeHTML(formatNumber(finalGap, 1)) + "%</strong>; shading is the observed five-seed min–max range, not a confidence interval.</p>" +
      '<div class="ppl-curve-legend" aria-hidden="true"><span class="legend-gene">DNA initialization</span><span class="legend-empty">Fresh empty</span><span class="legend-threshold">Frozen threshold</span><span class="legend-range">5-seed range</span></div>' +
      '<div class="ppl-canvas-wrap"><canvas class="ppl-curve-canvas" width="960" height="440" tabindex="0" role="img" aria-label="' + escapeHTML(ariaLabel) + '" aria-describedby="' + escapeHTML(summaryId) + " " + escapeHTML(liveId) + '" aria-keyshortcuts="ArrowLeft ArrowRight Home End"></canvas><div class="ppl-curve-tooltip" hidden></div></div>' +
      '<output class="sr-only" id="' + escapeHTML(liveId) + '" aria-live="polite"></output>' +
      convergenceDataTable(curve) + "</figure>";
  }

  function widthScalingDataTable(evidence) {
    const profileOrder = new Map(evidence.profiles.map(function (profile, index) { return [profile.variantId, index]; }));
    const corpusOrder = new Map(evidence.corpusIds.map(function (corpusId, index) { return [corpusId, index]; }));
    const rows = evidence.anchors.flatMap(function (anchor) {
      return anchor.cells.slice().sort(function (left, right) {
        return (profileOrder.get(left.variantId) || 0) - (profileOrder.get(right.variantId) || 0) ||
          (corpusOrder.get(left.corpusId) || 0) - (corpusOrder.get(right.corpusId) || 0);
      }).map(function (cell) {
        return "<tr><td>" + escapeHTML(fixedAnchorTokens(anchor.trainingTokens)) + " <small>(step " + escapeHTML(anchor.step) + ")</small></td><td>" +
          escapeHTML(cell.variantLabel) + "</td><td>" + escapeHTML(Number(cell.parameterCount).toLocaleString()) + "</td><td>" +
          escapeHTML(cell.corpusLabel) + "</td><td>" + escapeHTML(formatNumber(cell.meanRatio, 4)) + " <small>[" +
          escapeHTML(formatNumber(cell.minRatio, 4)) + "–" + escapeHTML(formatNumber(cell.maxRatio, 4)) + "]</small></td></tr>";
      });
    }).join("");
    const rowCount = evidence.anchors.reduce(function (total, anchor) { return total + anchor.cells.length; }, 0);
    return '<details class="ppl-curve-data width-scaling-data"><summary>Read all ' + escapeHTML(rowCount) + ' measured parameter-count values</summary><div class="ppl-curve-table-wrap"><table><thead><tr><th>Tokens</th><th>Model</th><th>Parameters</th><th>Corpus</th><th>DNA / empty PPL · 5-seed range</th></tr></thead><tbody>' + rows + "</tbody></table></div></details>";
  }

  function widthTrendSummary(evidence) {
    const trend = evidence.trend;
    const slopes = trend.seedRows.map(function (row) { return row.slope; });
    const positive = slopes.filter(function (slope) { return slope > 0; }).length;
    const negative = slopes.filter(function (slope) { return slope < 0; }).length;
    let direction;
    if (trend.classification === "strengthens_over_measured_width_range") {
      direction = "the DNA speed advantage strengthens across the measured parameter counts";
    } else if (trend.classification === "weakens_over_measured_width_range") {
      direction = "the DNA speed advantage weakens across the measured parameter counts";
    } else {
      direction = "the measured parameter-count direction remains inconclusive";
    }
    const mean = trend.meanSlope === null ? "not estimable" : ((trend.meanSlope > 0 ? "+" : "") + formatNumber(trend.meanSlope, 4));
    return {
      direction: direction,
      sentence: "The seed-blocked threshold-speed analysis finds that <strong>" + escapeHTML(direction) + "</strong>: " + escapeHTML(positive) + " positive and " + escapeHTML(negative) + " negative slopes across " + escapeHTML(slopes.length) + " held-out seeds, with a mean slope of <strong>" + escapeHTML(mean) + " log-speed advantage per parameter doubling</strong>. This is a descriptive trend across " + escapeHTML(evidence.profiles.length) + " exact parameter counts with unchanged DNA, not an inferential result or a model-size scaling law."
    };
  }

  function widthScalingTemplate(entry) {
    const evidence = entry.widthScalingEvidence;
    if (!evidence) return "";
    const summaryId = "width-summary-" + entry.id;
    const liveId = "width-live-" + entry.id;
    const selectId = "width-anchor-" + entry.id;
    const trendSummary = widthTrendSummary(evidence);
    const anchorOptions = evidence.anchors.map(function (anchor, index) {
      const selected = index === evidence.anchors.length - 1 ? " selected" : "";
      return '<option value="' + escapeHTML(index) + '"' + selected + ">" + escapeHTML(fixedAnchorTokens(anchor.trainingTokens)) + " tokens · step " + escapeHTML(anchor.step) + "</option>";
    }).join("");
    const legend = evidence.corpusIds.map(function (corpusId, index) {
      const cell = evidence.anchors.flatMap(function (anchor) { return anchor.cells; }).find(function (candidate) { return candidate.corpusId === corpusId; });
      return '<span class="width-series-' + escapeHTML(index % 3) + '">' + escapeHTML(cell ? cell.corpusLabel : corpusId) + "</span>";
    }).join("") + '<span class="legend-range">Observed 5-seed range</span>';
    const ariaLabel = "Fixed-DNA PPL ratio across " + evidence.profiles.length + " exact model parameter counts and " + evidence.corpusIds.length + " corpora. The horizontal axis is log base two of actual parameter count. A DNA to empty PPL ratio below one favors DNA. " + trendSummary.direction + ". Descriptive parameter-count evidence, not a scaling law.";
    return '<section class="drawer-section width-scaling-section"><h3>Fixed DNA × measured parameter count</h3><figure class="ppl-curve width-scaling" data-width-scaling><figcaption><strong>DNA / empty PPL across parameter counts</strong><span>Descriptive parameter-count trend · not a scaling law</span></figcaption>' +
      '<p class="ppl-curve-summary" id="' + escapeHTML(summaryId) + '">' + trendSummary.sentence + " Fixed-token ratios below 1.0 favor the unchanged DNA; bands show observed seed minima and maxima, not confidence intervals.</p>" +
      '<div class="width-anchor-control"><label for="' + escapeHTML(selectId) + '">Training-token checkpoint</label><select id="' + escapeHTML(selectId) + '" data-width-anchor-select>' + anchorOptions + "</select></div>" +
      '<div class="ppl-curve-legend width-scaling-legend" aria-hidden="true">' + legend + "</div>" +
      '<div class="ppl-canvas-wrap"><canvas class="ppl-curve-canvas width-scaling-canvas" width="960" height="400" tabindex="0" role="img" aria-label="' + escapeHTML(ariaLabel) + '" aria-describedby="' + escapeHTML(summaryId) + " " + escapeHTML(liveId) + '" aria-keyshortcuts="ArrowLeft ArrowRight Home End"></canvas><div class="ppl-curve-tooltip width-scaling-tooltip" hidden></div></div>' +
      '<output class="sr-only" id="' + escapeHTML(liveId) + '" aria-live="polite"></output>' + widthScalingDataTable(evidence) + "</figure></section>";
  }

  function jointCellFor(evidence, nominalScale, corpusRole) {
    return evidence.cells.find(function (cell) {
      return cell.profile.nominalScale === Number(nominalScale) && cell.corpus.role === corpusRole;
    }) || null;
  }

  function jointCellSummaryMarkup(cell) {
    if (!cell) return "";
    const profile = cell.profile;
    const gate = cell.gatePassed ? "passes the 10% cell gate" : "does not pass the complete cell gate";
    return '<strong>' + escapeHTML(Number(profile.parameterCount).toLocaleString()) + ' parameters · ' +
      escapeHTML(Number(profile.prefixLength).toLocaleString()) + ' corpus tokens</strong> · ' +
      escapeHTML(cell.corpus.label) + ' · ' +
      escapeHTML(compactTokens(profile.transitionTokens)) + ' independent sequential transitions. Threshold gain <strong>' +
      escapeHTML(signedPercent(cell.gain === null ? null : cell.gain * 100)) + '</strong>, ' + escapeHTML(cell.positiveSeeds) + '/5 positive seeds; ' +
      escapeHTML(gate) + '. Model parameters and corpus tokens are the measured public coordinates.';
  }

  function jointTrendSummary(evidence) {
    const trend = evidence.trend;
    const slopes = trend.seedRows.map(function (row) { return row.slope; }).filter(function (value) { return value !== null; });
    const positive = slopes.filter(function (slope) { return slope > 0; }).length;
    const negative = slopes.filter(function (slope) { return slope < 0; }).length;
    let direction;
    if (trend.classification === "strengthens_over_measured_joint_scale_range") {
      direction = "the DNA speed advantage strengthens over the measured joint scales";
    } else if (trend.classification === "weakens_over_measured_joint_scale_range") {
      direction = "the DNA speed advantage weakens over the measured joint scales";
    } else {
      direction = "the measured joint-scale direction remains inconclusive";
    }
    const mean = trend.meanSlope === null ? "not estimable" : ((trend.meanSlope > 0 ? "+" : "") + formatNumber(trend.meanSlope, 4));
    return "The seed-blocked descriptive trend indicates that <strong>" + escapeHTML(direction) + "</strong>" +
      (slopes.length ? ": " + escapeHTML(positive) + " positive and " + escapeHTML(negative) + " negative seed slopes" : "") +
      ", with a mean of <strong>" + escapeHTML(mean) + " log-speed advantage per doubling of the prescribed joint budget</strong>. " +
      "Model capacity and independent corpus exposure change together here, so their effects cannot be separated and this is not a general scaling law.";
  }

  function jointScalingMatrix(evidence) {
    const headers = evidence.corpora.map(function (corpus) {
      return '<th scope="col"><span>' + escapeHTML(corpus.label) + '</span>' +
        (corpus.sourceLabel ? '<small>' + escapeHTML(corpus.sourceLabel) + '</small>' : '') + '</th>';
    }).join("");
    const rows = evidence.profiles.map(function (profile) {
      const cells = evidence.corpora.map(function (corpus) {
        const cell = jointCellFor(evidence, profile.nominalScale, corpus.role);
        const status = cell && cell.gatePassed ? "verified" : "experimental";
        return '<td class="joint-matrix-cell" data-status="' + escapeHTML(status) + '"><span class="status status-' + escapeHTML(status) + '">' +
          escapeHTML(statusDisplay(status)) + '</span><strong>' + escapeHTML(cell ? signedPercent(cell.gain === null ? null : cell.gain * 100) : "—") +
          '</strong><span>' + escapeHTML(cell ? cell.positiveSeeds + '/5 positive' : "No result") + '</span><small>' +
          escapeHTML(cell ? 'PPL ≤ ' + formatNumber(cell.thresholdPpl, 3) + ' · AUC ' + signedPercent(cell.aucGain === null ? null : cell.aucGain * 100) : "") +
          '</small></td>';
      }).join("");
      return '<tr><th scope="row"><strong>' + escapeHTML(Number(profile.parameterCount).toLocaleString()) +
        ' parameters</strong><span>' + escapeHTML(Number(profile.prefixLength).toLocaleString()) +
        ' corpus tokens</span><small>' + escapeHTML(compactTokens(profile.transitionTokens)) +
        ' training transitions</small></th>' + cells + '</tr>';
    }).join("");
    return '<div class="joint-scaling-matrix-wrap"><table class="joint-scaling-matrix"><caption>Unchanged DNA effect by measured model parameters and corpus tokens</caption><thead><tr><th scope="col">Model parameters · corpus tokens</th>' +
      headers + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function jointCurveDataTable(cell) {
    const rows = cell.curve.points.map(function (point) {
      return '<tr><td>' + escapeHTML(formatNumber(point.corpusFraction * 100, 1)) + '%</td><td>' +
        escapeHTML(compactTokens(point.trainingTokens)) + '</td><td>' + escapeHTML(formatNumber(point.tokensPerParameter, 3)) +
        '</td><td>' + escapeHTML(formatNumber(point.empty.geometricMeanPpl, 3)) + ' <small>[' +
        escapeHTML(formatNumber(point.empty.minPpl, 3)) + '–' + escapeHTML(formatNumber(point.empty.maxPpl, 3)) +
        ']</small></td><td>' + escapeHTML(formatNumber(point.gene.geometricMeanPpl, 3)) + ' <small>[' +
        escapeHTML(formatNumber(point.gene.minPpl, 3)) + '–' + escapeHTML(formatNumber(point.gene.maxPpl, 3)) +
        ']</small></td><td>' + escapeHTML(formatNumber(point.ratio.geometricMean, 3)) + ' <small>[' +
        escapeHTML(formatNumber(point.ratio.min, 3)) + '–' + escapeHTML(formatNumber(point.ratio.max, 3)) + ']</small></td></tr>';
    }).join("");
    return '<details class="ppl-curve-data joint-curve-data"><summary>Read all 32 selected-cell checkpoints</summary><div class="ppl-curve-table-wrap"><table><thead><tr><th>Prefix</th><th>Tokens</th><th>Tokens / param</th><th>Empty PPL · range</th><th>DNA PPL · range</th><th>DNA / empty · range</th></tr></thead><tbody>' +
      rows + '</tbody></table></div></details>';
  }

  function jointScalingTemplate(entry) {
    const evidence = entry.jointScalingEvidence;
    if (!evidence) return "";
    const initialProfile = evidence.profiles[evidence.profiles.length - 1];
    const initialCorpus = evidence.corpora[0];
    const initialCell = jointCellFor(evidence, initialProfile.nominalScale, initialCorpus.role);
    if (!initialCell) return "";
    const corpusSelectId = "joint-corpus-" + entry.id;
    const scaleSelectId = "joint-scale-" + entry.id;
    const summaryId = "joint-summary-" + entry.id;
    const liveId = "joint-live-" + entry.id;
    const corpusOptions = evidence.corpora.map(function (corpus, index) {
      return '<option value="' + escapeHTML(corpus.role) + '"' + (index === 0 ? " selected" : "") + '>' + escapeHTML(corpus.label) + '</option>';
    }).join("");
    const scaleOptions = evidence.profiles.map(function (profile, index) {
      const selected = index === evidence.profiles.length - 1 ? " selected" : "";
      return '<option value="' + escapeHTML(profile.nominalScale) + '"' + selected + '>' +
        escapeHTML(Number(profile.parameterCount).toLocaleString()) + ' parameters · ' +
        escapeHTML(Number(profile.prefixLength).toLocaleString()) + ' corpus tokens</option>';
    }).join("");
    const masterTokens = numeric(valueFrom(evidence.sliceContract, ["master_train_tokens", "masterTrainTokens"], null));
    const contractNote = "Each cell consumes one continuous, sequential, no-replacement pass over a literal prefix of " +
      (masterTokens === null ? "one pinned master stream" : "one pinned " + Number(masterTokens).toLocaleString() + "-token master stream") +
      "; the three displayed corpus budgets are nested prefixes rather than copied or stitched training text.";
    const ariaLabel = "Validation PPL for one selected model parameter count and corpus token budget. The upper panel compares unchanged DNA with fresh empty initialization; the lower panel shows the paired DNA to empty PPL ratio over a normalized continuous corpus prefix. Model size and corpus size change together and are not causally separable.";
    return '<section class="drawer-section joint-scaling-section"><h3>Measured model + corpus size</h3>' +
      '<p class="joint-contract-note">' + escapeHTML(contractNote) + '</p>' + jointScalingMatrix(evidence) +
      '<figure class="ppl-curve joint-scaling" data-joint-scaling><figcaption><strong>PPL convergence over one normalized corpus pass</strong><span>Exact parameter and corpus-token counts</span></figcaption>' +
      '<p class="ppl-curve-summary" id="' + escapeHTML(summaryId) + '">' + jointTrendSummary(evidence) + '</p>' +
      '<div class="joint-scaling-controls"><div><label for="' + escapeHTML(corpusSelectId) + '">Independent corpus</label><select id="' + escapeHTML(corpusSelectId) + '" data-joint-corpus-select>' + corpusOptions +
      '</select></div><div><label for="' + escapeHTML(scaleSelectId) + '">Model parameters + corpus tokens</label><select id="' + escapeHTML(scaleSelectId) + '" data-joint-scale-select>' + scaleOptions + '</select></div></div>' +
      '<p class="joint-cell-summary" data-joint-cell-summary>' + jointCellSummaryMarkup(initialCell) + '</p>' +
      '<div class="ppl-curve-legend" aria-hidden="true"><span class="legend-gene">DNA initialization</span><span class="legend-empty">Fresh empty</span><span class="legend-threshold">Scale-specific threshold</span><span class="legend-range">5-seed range</span></div>' +
      '<div class="ppl-canvas-wrap"><canvas class="ppl-curve-canvas joint-scaling-canvas" width="960" height="440" tabindex="0" role="img" aria-label="' + escapeHTML(ariaLabel) + '" aria-describedby="' + escapeHTML(summaryId) + ' ' + escapeHTML(liveId) + '" aria-keyshortcuts="ArrowLeft ArrowRight Home End"></canvas><div class="ppl-curve-tooltip joint-scaling-tooltip" hidden></div></div>' +
      '<output class="sr-only" id="' + escapeHTML(liveId) + '" aria-live="polite"></output><div data-joint-curve-data>' + jointCurveDataTable(initialCell) + '</div></figure>' +
      '<a class="drawer-evidence-link joint-evidence-link" href="' + escapeHTML(evidence.sourceUrl) + '">Open joint-scaling evidence <span aria-hidden="true">↗</span></a></section>';
  }

  function cleanupCurveCharts() {
    activeCurveCharts.forEach(function (chart) {
      if (chart.observer) chart.observer.disconnect();
      if (chart.resizeHandler) window.removeEventListener("resize", chart.resizeHandler);
    });
    activeCurveCharts = [];
  }

  function nearestCurvePoint(points, targetTokens) {
    let nearest = 0;
    let distance = Infinity;
    points.forEach(function (point, index) {
      const current = Math.abs(point.trainingTokens - targetTokens);
      if (current < distance) {
        distance = current;
        nearest = index;
      }
    });
    return nearest;
  }

  function lineageArmStyle(key) {
    return {
      fresh_empty: { color: "#5e696a", fill: "rgba(94,105,106,.10)", dash: [7, 5], width: 2 },
      inherited_native: { color: "#075e63", fill: "rgba(7,94,99,.11)", dash: [], width: 2.5 },
      selected_offspring: { color: "#4f4b7a", fill: "rgba(79,75,122,.10)", dash: [], width: 2.7 }
    }[key] || { color: "#075e63", fill: "rgba(7,94,99,.1)", dash: [], width: 2.3 };
  }

  function lineageRatioStyle(key) {
    return {
      inherited_native_to_fresh_empty: { color: "#075e63", fill: "rgba(7,94,99,.08)", dash: [] },
      selected_offspring_to_fresh_empty: { color: "#4f4b7a", fill: "rgba(79,75,122,.07)", dash: [] },
      selected_offspring_to_inherited_native: { color: "#a25e05", fill: "rgba(162,94,5,.06)", dash: [5, 4] }
    }[key] || { color: "#075e63", fill: "rgba(7,94,99,.07)", dash: [] };
  }

  function drawLineageCurveChart(chart) {
    const canvas = chart.canvas;
    const context = canvas.getContext && canvas.getContext("2d");
    if (!context) return false;
    const curve = chart.claim.convergenceCurve;
    const points = curve.points;
    const cssWidth = Math.max(1, Math.floor(canvas.getBoundingClientRect().width || 760));
    const cssHeight = 440;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(cssWidth * pixelRatio);
    const pixelHeight = Math.round(cssHeight * pixelRatio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.fillStyle = "#fffdf7";
    context.fillRect(0, 0, cssWidth, cssHeight);

    const horizontalMargin = Math.max(38, Math.min(60, cssWidth * 0.16));
    const rightMargin = Math.max(8, Math.min(18, cssWidth * 0.04));
    const plot = { left: horizontalMargin, right: cssWidth - rightMargin, top: 25, bottom: 282 };
    const ratioPlot = { left: plot.left, right: plot.right, top: 330, bottom: 398 };
    const maxTokens = Math.max.apply(null, points.map(function (point) { return point.trainingTokens; }));
    const allPpl = [curve.thresholdPpl];
    points.forEach(function (point) {
      curve.armKeys.forEach(function (key) {
        allPpl.push(point.arms[key].minPpl, point.arms[key].maxPpl);
      });
    });
    const dataLogMin = Math.log(Math.min.apply(null, allPpl));
    const dataLogMax = Math.log(Math.max.apply(null, allPpl));
    const logPadding = Math.max(0.04, (dataLogMax - dataLogMin) * 0.06);
    const logMin = dataLogMin - logPadding;
    const logMax = dataLogMax + logPadding;
    const yMin = Math.exp(logMin);
    const yMax = Math.exp(logMax);
    const xFor = function (tokens) { return plot.left + (tokens / maxTokens) * (plot.right - plot.left); };
    const yFor = function (ppl) {
      return plot.bottom - ((Math.log(ppl) - logMin) / (logMax - logMin)) * (plot.bottom - plot.top);
    };
    const allRatios = [];
    points.forEach(function (point) {
      curve.ratioKeys.forEach(function (key) {
        allRatios.push(point.pairedRatios[key].min, point.pairedRatios[key].max);
      });
    });
    const ratioMin = Math.max(0.05, Math.min.apply(null, allRatios) - 0.04);
    const ratioMax = Math.max(1.02, Math.max.apply(null, allRatios) + 0.03);
    const ratioY = function (value) {
      return ratioPlot.bottom - ((value - ratioMin) / (ratioMax - ratioMin)) * (ratioPlot.bottom - ratioPlot.top);
    };
    chart.geometry = { plot: plot, ratioPlot: ratioPlot, maxTokens: maxTokens, xFor: xFor, yFor: yFor, ratioY: ratioY };

    context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.lineWidth = 1;
    context.strokeStyle = "#d6d3c9";
    context.fillStyle = "#667575";
    context.textAlign = "right";
    const ticks = [];
    for (let exponent = Math.floor(Math.log10(yMin)); exponent <= Math.ceil(Math.log10(yMax)); exponent += 1) {
      [1, 2, 5].forEach(function (multiple) {
        const tick = multiple * Math.pow(10, exponent);
        if (tick >= yMin && tick <= yMax) ticks.push(tick);
      });
    }
    ticks.forEach(function (tick) {
      const y = yFor(tick);
      context.beginPath();
      context.moveTo(plot.left, y);
      context.lineTo(plot.right, y);
      context.stroke();
      context.fillText(formatNumber(tick, tick < 10 ? 1 : 0), plot.left - 8, y + 3);
    });
    context.textAlign = "center";
    [0, 0.25, 0.5, 0.75, 1].forEach(function (fraction) {
      const x = plot.left + fraction * (plot.right - plot.left);
      context.beginPath();
      context.moveTo(x, plot.top);
      context.lineTo(x, ratioPlot.bottom);
      context.stroke();
      context.fillText(compactTokens(maxTokens * fraction), x, ratioPlot.bottom + 18);
    });
    context.save();
    context.translate(14, (plot.top + plot.bottom) / 2);
    context.rotate(-Math.PI / 2);
    context.fillText("Validation PPL · log scale", 0, 0);
    context.restore();
    context.fillText("Cumulative training tokens", (plot.left + plot.right) / 2, 431);
    context.textAlign = "left";
    context.fillText("Paired PPL ratio · below 1 favors numerator", plot.left, ratioPlot.top - 10);

    function drawBand(lowAt, highAt, yScale, fillStyle) {
      context.beginPath();
      points.forEach(function (point, index) {
        const x = xFor(point.trainingTokens);
        const y = yScale(highAt(point));
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      points.slice().reverse().forEach(function (point) {
        context.lineTo(xFor(point.trainingTokens), yScale(lowAt(point)));
      });
      context.closePath();
      context.fillStyle = fillStyle;
      context.fill();
    }
    function drawLine(valueAt, yScale, style, width) {
      context.beginPath();
      points.forEach(function (point, index) {
        const x = xFor(point.trainingTokens);
        const y = yScale(valueAt(point));
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = style.color;
      context.lineWidth = width;
      context.setLineDash(style.dash);
      context.stroke();
      context.setLineDash([]);
    }
    curve.armKeys.forEach(function (key) {
      const style = lineageArmStyle(key);
      drawBand(function (point) { return point.arms[key].minPpl; }, function (point) { return point.arms[key].maxPpl; }, yFor, style.fill);
    });
    curve.ratioKeys.forEach(function (key) {
      const style = lineageRatioStyle(key);
      drawBand(function (point) { return point.pairedRatios[key].min; }, function (point) { return point.pairedRatios[key].max; }, ratioY, style.fill);
    });
    curve.armKeys.forEach(function (key) {
      const style = lineageArmStyle(key);
      drawLine(function (point) { return point.arms[key].geometricMeanPpl; }, yFor, style, style.width);
    });
    curve.ratioKeys.forEach(function (key) {
      const style = lineageRatioStyle(key);
      drawLine(function (point) { return point.pairedRatios[key].geometricMean; }, ratioY, style, 2.1);
    });

    const thresholdY = yFor(curve.thresholdPpl);
    context.strokeStyle = "#a25e05";
    context.lineWidth = 1.5;
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(plot.left, thresholdY);
    context.lineTo(plot.right, thresholdY);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#a25e05";
    context.textAlign = "right";
    context.fillText("threshold " + formatNumber(curve.thresholdPpl, 2), plot.right - 4, thresholdY - 5);
    context.strokeStyle = "#9ca5a2";
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(ratioPlot.left, ratioY(1));
    context.lineTo(ratioPlot.right, ratioY(1));
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#667575";
    context.fillText("1.0", ratioPlot.left - 8, ratioY(1) + 3);

    if (chart.activeIndex >= 0 && chart.activeIndex < points.length) {
      const point = points[chart.activeIndex];
      const x = xFor(point.trainingTokens);
      context.strokeStyle = "rgba(7,21,29,.38)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, plot.top);
      context.lineTo(x, ratioPlot.bottom);
      context.stroke();
      curve.armKeys.forEach(function (key) {
        const style = lineageArmStyle(key);
        context.fillStyle = "#fffdf7";
        context.strokeStyle = style.color;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(x, yFor(point.arms[key].geometricMeanPpl), 4, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      });
      curve.ratioKeys.forEach(function (key) {
        const style = lineageRatioStyle(key);
        context.fillStyle = "#fffdf7";
        context.strokeStyle = style.color;
        context.beginPath();
        context.arc(x, ratioY(point.pairedRatios[key].geometricMean), 3.5, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      });
    }
    return true;
  }

  function drawCurveChart(chart) {
    if (chart.claim.convergenceCurve.mode === "lineage") return drawLineageCurveChart(chart);
    const canvas = chart.canvas;
    const context = canvas.getContext && canvas.getContext("2d");
    if (!context) return false;
    const curve = chart.claim.convergenceCurve;
    const points = curve.points;
    const cssWidth = Math.max(1, Math.floor(canvas.getBoundingClientRect().width || 760));
    const cssHeight = 440;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(cssWidth * ratio);
    const pixelHeight = Math.round(cssHeight * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.fillStyle = "#fffdf7";
    context.fillRect(0, 0, cssWidth, cssHeight);

    const horizontalMargin = Math.max(36, Math.min(58, cssWidth * 0.16));
    const rightMargin = Math.max(8, Math.min(18, cssWidth * 0.04));
    const plot = { left: horizontalMargin, right: cssWidth - rightMargin, top: 25, bottom: 282 };
    const ratioPlot = { left: plot.left, right: plot.right, top: 330, bottom: 398 };
    const maxTokens = Math.max.apply(null, points.map(function (point) { return point.trainingTokens; }));
    const allPpl = [];
    points.forEach(function (point) {
      allPpl.push(point.empty.minPpl, point.empty.maxPpl, point.gene.minPpl, point.gene.maxPpl);
    });
    allPpl.push(curve.thresholdPpl);
    const dataLogMin = Math.log(Math.min.apply(null, allPpl));
    const dataLogMax = Math.log(Math.max.apply(null, allPpl));
    const logPadding = Math.max(0.04, (dataLogMax - dataLogMin) * 0.06);
    const yMin = Math.exp(dataLogMin - logPadding);
    const yMax = Math.exp(dataLogMax + logPadding);
    const logMin = Math.log(yMin);
    const logMax = Math.log(yMax);
    const xFor = function (tokens) {
      return plot.left + (tokens / maxTokens) * (plot.right - plot.left);
    };
    const yFor = function (ppl) {
      return plot.bottom - ((Math.log(ppl) - logMin) / (logMax - logMin)) * (plot.bottom - plot.top);
    };
    const ratioMin = Math.max(0.2, Math.min.apply(null, points.map(function (point) { return point.ratio.min; })) - 0.05);
    const ratioMax = Math.max(1.02, Math.max.apply(null, points.map(function (point) { return point.ratio.max; })) + 0.02);
    const ratioY = function (value) {
      return ratioPlot.bottom - ((value - ratioMin) / (ratioMax - ratioMin)) * (ratioPlot.bottom - ratioPlot.top);
    };
    chart.geometry = { plot: plot, ratioPlot: ratioPlot, maxTokens: maxTokens, xFor: xFor, yFor: yFor, ratioY: ratioY };

    context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.lineWidth = 1;
    context.strokeStyle = "#d6d3c9";
    context.fillStyle = "#667575";
    context.textAlign = "right";
    [4, 5, 7, 10, 20, 40, 80].filter(function (tick) { return tick >= yMin && tick <= yMax; }).forEach(function (tick) {
      const y = yFor(tick);
      context.beginPath();
      context.moveTo(plot.left, y);
      context.lineTo(plot.right, y);
      context.stroke();
      context.fillText(String(tick), plot.left - 8, y + 3);
    });
    context.textAlign = "center";
    [0, 0.25, 0.5, 0.75, 1].forEach(function (fraction) {
      const x = plot.left + fraction * (plot.right - plot.left);
      context.beginPath();
      context.moveTo(x, plot.top);
      context.lineTo(x, ratioPlot.bottom);
      context.stroke();
      context.fillText(compactTokens(maxTokens * fraction), x, ratioPlot.bottom + 18);
    });
    context.save();
    context.translate(14, (plot.top + plot.bottom) / 2);
    context.rotate(-Math.PI / 2);
    context.fillText("Validation PPL · log scale", 0, 0);
    context.restore();
    context.fillText("Cumulative training tokens", (plot.left + plot.right) / 2, 431);
    context.textAlign = "left";
    context.fillText("Paired DNA / empty PPL", plot.left, ratioPlot.top - 10);

    function drawBand(series, lowField, highField, yScale, fillStyle) {
      context.beginPath();
      series.forEach(function (point, index) {
        const x = xFor(point.trainingTokens);
        const y = yScale(point[highField]);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      series.slice().reverse().forEach(function (point) {
        context.lineTo(xFor(point.trainingTokens), yScale(point[lowField]));
      });
      context.closePath();
      context.fillStyle = fillStyle;
      context.fill();
    }

    drawBand(points.map(function (point) { return { trainingTokens: point.trainingTokens, low: point.empty.minPpl, high: point.empty.maxPpl }; }), "low", "high", yFor, "rgba(94,105,106,.12)");
    drawBand(points.map(function (point) { return { trainingTokens: point.trainingTokens, low: point.gene.minPpl, high: point.gene.maxPpl }; }), "low", "high", yFor, "rgba(7,94,99,.13)");
    drawBand(points.map(function (point) { return { trainingTokens: point.trainingTokens, low: point.ratio.min, high: point.ratio.max }; }), "low", "high", ratioY, "rgba(7,94,99,.13)");

    function drawLine(valueAt, yScale, color, dash, width) {
      context.beginPath();
      points.forEach(function (point, index) {
        const x = xFor(point.trainingTokens);
        const y = yScale(valueAt(point));
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = color;
      context.lineWidth = width;
      context.setLineDash(dash);
      context.stroke();
      context.setLineDash([]);
    }

    drawLine(function (point) { return point.empty.geometricMeanPpl; }, yFor, "#5e696a", [7, 5], 2);
    drawLine(function (point) { return point.gene.geometricMeanPpl; }, yFor, "#075e63", [], 2.7);
    drawLine(function (point) { return point.ratio.geometricMean; }, ratioY, "#075e63", [], 2.4);

    const thresholdY = yFor(curve.thresholdPpl);
    context.strokeStyle = "#a25e05";
    context.lineWidth = 1.5;
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(plot.left, thresholdY);
    context.lineTo(plot.right, thresholdY);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#a25e05";
    context.textAlign = "right";
    context.fillText("threshold " + formatNumber(curve.thresholdPpl, 2), plot.right - 4, thresholdY - 5);

    context.strokeStyle = "#9ca5a2";
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(ratioPlot.left, ratioY(1));
    context.lineTo(ratioPlot.right, ratioY(1));
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#667575";
    context.textAlign = "right";
    context.fillText("1.0", ratioPlot.left - 8, ratioY(1) + 3);
    context.fillText(formatNumber(ratioMin, 2), ratioPlot.left - 8, ratioPlot.bottom + 3);

    [
      { tokens: chart.claim.candidateMeanTokens, color: "#075e63", label: "DNA mean" },
      { tokens: chart.claim.baselineMeanTokens, color: "#5e696a", label: "empty mean" }
    ].forEach(function (marker, index) {
      if (marker.tokens === null || marker.tokens <= 0 || marker.tokens > maxTokens) return;
      const x = xFor(marker.tokens);
      context.fillStyle = marker.color;
      context.beginPath();
      context.arc(x, thresholdY, 3.5, 0, Math.PI * 2);
      context.fill();
      context.textAlign = index === 0 ? "right" : "left";
      context.fillText(marker.label, x + (index === 0 ? -6 : 6), thresholdY + 15 + index * 11);
    });

    if (chart.activeIndex >= 0 && chart.activeIndex < points.length) {
      const point = points[chart.activeIndex];
      const x = xFor(point.trainingTokens);
      context.strokeStyle = "rgba(7,21,29,.38)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, plot.top);
      context.lineTo(x, ratioPlot.bottom);
      context.stroke();
      [
        { y: yFor(point.empty.geometricMeanPpl), color: "#5e696a" },
        { y: yFor(point.gene.geometricMeanPpl), color: "#075e63" },
        { y: ratioY(point.ratio.geometricMean), color: "#075e63" }
      ].forEach(function (marker) {
        context.fillStyle = "#fffdf7";
        context.strokeStyle = marker.color;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(x, marker.y, 4, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      });
    }
    return true;
  }

  function updateCurveCheckpoint(chart, index, announce) {
    const points = chart.claim.convergenceCurve.points;
    chart.activeIndex = Math.max(0, Math.min(points.length - 1, index));
    drawCurveChart(chart);
    const point = points[chart.activeIndex];
    const curve = chart.claim.convergenceCurve;
    let message;
    if (curve.mode === "lineage") {
      const arms = curve.armKeys.map(function (key) {
        const arm = point.arms[key];
        return (LINEAGE_ARM_LABELS[key] || titleCase(key)) + " PPL " + formatNumber(arm.geometricMeanPpl, 3) +
          " [" + formatNumber(arm.minPpl, 3) + "–" + formatNumber(arm.maxPpl, 3) + "]";
      });
      const ratios = curve.ratioKeys.map(function (key) {
        const ratio = point.pairedRatios[key];
        return (LINEAGE_RATIO_LABELS[key] || titleCase(key)) + " " + formatNumber(ratio.geometricMean, 3) +
          " [" + formatNumber(ratio.min, 3) + "–" + formatNumber(ratio.max, 3) + "]";
      });
      message = compactTokens(point.trainingTokens) + " tokens · step " + point.step + " · " + arms.concat(ratios).join(" · ");
    } else {
      message = compactTokens(point.trainingTokens) + " tokens · step " + point.step + " · Empty PPL " + formatNumber(point.empty.geometricMeanPpl, 3) + " [" + formatNumber(point.empty.minPpl, 3) + "–" + formatNumber(point.empty.maxPpl, 3) + "] · DNA PPL " + formatNumber(point.gene.geometricMeanPpl, 3) + " [" + formatNumber(point.gene.minPpl, 3) + "–" + formatNumber(point.gene.maxPpl, 3) + "] · DNA/empty " + formatNumber(point.ratio.geometricMean, 3);
    }
    chart.tooltip.textContent = message;
    chart.tooltip.hidden = false;
    const geometry = chart.geometry;
    const x = geometry ? geometry.xFor(point.trainingTokens) : 80;
    const tooltipBox = curve.mode === "lineage" ? 406 : 286;
    const maxLeft = Math.max(8, chart.canvas.clientWidth - tooltipBox);
    chart.tooltip.style.left = Math.max(8, Math.min(maxLeft, x - (curve.mode === "lineage" ? 195 : 135))) + "px";
    chart.tooltip.style.top = "38px";
    if (announce) chart.output.textContent = message;
  }

  function initializeCurveCharts(entry) {
    cleanupCurveCharts();
    const claims = new Map((entry.evidence || []).map(function (claim) { return [claim.id, claim]; }));
    drawerContent.querySelectorAll("[data-curve-claim-id]").forEach(function (figure) {
      const claim = claims.get(figure.dataset.curveClaimId);
      const canvas = figure.querySelector(".ppl-curve-canvas");
      const tooltip = figure.querySelector(".ppl-curve-tooltip");
      const output = figure.querySelector("output");
      const details = figure.querySelector(".ppl-curve-data");
      if (!claim || !claim.convergenceCurve || !canvas || !tooltip || !output) return;
      const chart = { claim: claim, canvas: canvas, tooltip: tooltip, output: output, details: details, activeIndex: -1, observer: null, resizeHandler: null, geometry: null };
      if (!drawCurveChart(chart)) {
        figure.classList.add("no-canvas");
        if (details) details.open = true;
        return;
      }
      const redraw = function () { window.requestAnimationFrame(function () { drawCurveChart(chart); }); };
      if (typeof ResizeObserver === "function") {
        chart.observer = new ResizeObserver(redraw);
        chart.observer.observe(canvas);
      } else {
        chart.resizeHandler = redraw;
        window.addEventListener("resize", redraw);
      }
      const selectPointerCheckpoint = function (event) {
        if (!chart.geometry) return;
        const rect = canvas.getBoundingClientRect();
        const localX = event.clientX - rect.left;
        const fraction = Math.max(0, Math.min(1, (localX - chart.geometry.plot.left) / (chart.geometry.plot.right - chart.geometry.plot.left)));
        updateCurveCheckpoint(chart, nearestCurvePoint(claim.convergenceCurve.points, fraction * chart.geometry.maxTokens), false);
      };
      canvas.addEventListener("pointermove", selectPointerCheckpoint);
      canvas.addEventListener("pointerdown", function (event) {
        canvas.focus({ preventScroll: true });
        selectPointerCheckpoint(event);
      });
      canvas.addEventListener("pointerleave", function () {
        if (document.activeElement !== canvas) {
          chart.activeIndex = -1;
          tooltip.hidden = true;
          drawCurveChart(chart);
        }
      });
      canvas.addEventListener("focus", function () {
        const target = claim.candidateMeanTokens === null ? claim.convergenceCurve.points[claim.convergenceCurve.points.length - 1].trainingTokens : claim.candidateMeanTokens;
        updateCurveCheckpoint(chart, nearestCurvePoint(claim.convergenceCurve.points, target), true);
      });
      canvas.addEventListener("blur", function () {
        chart.activeIndex = -1;
        tooltip.hidden = true;
        drawCurveChart(chart);
      });
      canvas.addEventListener("keydown", function (event) {
        let next = chart.activeIndex < 0 ? 0 : chart.activeIndex;
        if (event.key === "ArrowLeft") next -= 1;
        else if (event.key === "ArrowRight") next += 1;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = claim.convergenceCurve.points.length - 1;
        else return;
        event.preventDefault();
        updateCurveCheckpoint(chart, next, true);
      });
      activeCurveCharts.push(chart);
    });
    initializeWidthScalingChart(entry);
    initializeJointScalingChart(entry);
  }

  function drawWidthScalingChart(chart) {
    const canvas = chart.canvas;
    const context = canvas.getContext && canvas.getContext("2d");
    if (!context) return false;
    const evidence = chart.evidence;
    const anchor = evidence.anchors[chart.anchorIndex];
    if (!anchor) return false;
    const cssWidth = Math.max(1, Math.floor(canvas.getBoundingClientRect().width || 760));
    const cssHeight = 400;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(cssWidth * ratio);
    const pixelHeight = Math.round(cssHeight * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.fillStyle = "#fffdf7";
    context.fillRect(0, 0, cssWidth, cssHeight);

    const horizontalMargin = Math.max(43, Math.min(62, cssWidth * 0.18));
    const rightMargin = Math.max(30, Math.min(48, cssWidth * 0.08));
    const plot = { left: horizontalMargin, right: cssWidth - rightMargin, top: 35, bottom: 326 };
    const logParameters = evidence.profiles.map(function (profile) { return Math.log2(profile.parameterCount); });
    const xMin = Math.min.apply(null, logParameters);
    const xMax = Math.max.apply(null, logParameters);
    const xFor = function (parameterCount) {
      return plot.left + ((Math.log2(parameterCount) - xMin) / (xMax - xMin)) * (plot.right - plot.left);
    };
    const allCells = anchor.cells.filter(function (cell) {
      return evidence.profiles.some(function (profile) { return profile.variantId === cell.variantId; }) && evidence.corpusIds.includes(cell.corpusId);
    });
    if (!allCells.length) return false;
    const yMin = Math.max(0.05, Math.min.apply(null, allCells.map(function (cell) { return cell.minRatio; })) - 0.06);
    const yMax = Math.max(1.04, Math.max.apply(null, allCells.map(function (cell) { return cell.maxRatio; })) + 0.04);
    const yFor = function (value) {
      return plot.bottom - ((value - yMin) / (yMax - yMin)) * (plot.bottom - plot.top);
    };
    const xPositions = evidence.profiles.map(function (profile) { return xFor(profile.parameterCount); });
    chart.geometry = { plot: plot, xFor: xFor, yFor: yFor, xPositions: xPositions };

    context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.lineWidth = 1;
    context.strokeStyle = "#d6d3c9";
    context.fillStyle = "#667575";
    context.textAlign = "right";
    const yTicks = [yMin, yMin + (yMax - yMin) * 0.25, yMin + (yMax - yMin) * 0.5, yMin + (yMax - yMin) * 0.75, yMax];
    yTicks.forEach(function (tick) {
      const y = yFor(tick);
      context.beginPath();
      context.moveTo(plot.left, y);
      context.lineTo(plot.right, y);
      context.stroke();
      context.fillText(formatNumber(tick, 2), plot.left - 8, y + 3);
    });
    const referenceY = yFor(1);
    context.strokeStyle = "#7c8684";
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(plot.left, referenceY);
    context.lineTo(plot.right, referenceY);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#667575";
    context.fillText("1.0", plot.left - 8, referenceY + 3);

    context.textAlign = "center";
    evidence.profiles.forEach(function (profile) {
      const x = xFor(profile.parameterCount);
      context.strokeStyle = "#d6d3c9";
      context.beginPath();
      context.moveTo(x, plot.top);
      context.lineTo(x, plot.bottom);
      context.stroke();
      context.fillStyle = "#667575";
      context.fillText(compactTokens(profile.parameterCount), x, plot.bottom + 20);
    });
    context.save();
    context.translate(14, (plot.top + plot.bottom) / 2);
    context.rotate(-Math.PI / 2);
    context.fillText("DNA / empty validation PPL", 0, 0);
    context.restore();
    context.fillText("Actual parameter count · log₂ scale", (plot.left + plot.right) / 2, 383);
    context.textAlign = "left";
    context.fillStyle = "#667575";
    context.fillText(fixedAnchorTokens(anchor.trainingTokens) + " tokens · step " + anchor.step, plot.left, 20);

    const styles = [
      { color: "#075e63", fill: "rgba(7,94,99,.11)", dash: [] },
      { color: "#a25e05", fill: "rgba(162,94,5,.09)", dash: [8, 5] },
      { color: "#4f4b7a", fill: "rgba(79,75,122,.09)", dash: [2, 4] }
    ];
    evidence.corpusIds.forEach(function (corpusId, corpusIndex) {
      const style = styles[corpusIndex % styles.length];
      const cells = evidence.profiles.map(function (profile) {
        return anchor.cells.find(function (cell) { return cell.variantId === profile.variantId && cell.corpusId === corpusId; });
      }).filter(Boolean);
      if (!cells.length) return;
      context.beginPath();
      cells.forEach(function (cell, index) {
        const x = xFor(cell.parameterCount);
        const y = yFor(cell.maxRatio);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      cells.slice().reverse().forEach(function (cell) { context.lineTo(xFor(cell.parameterCount), yFor(cell.minRatio)); });
      context.closePath();
      context.fillStyle = style.fill;
      context.fill();
      context.beginPath();
      cells.forEach(function (cell, index) {
        const x = xFor(cell.parameterCount);
        const y = yFor(cell.meanRatio);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = style.color;
      context.lineWidth = 2.4;
      context.setLineDash(style.dash);
      context.stroke();
      context.setLineDash([]);
      cells.forEach(function (cell) {
        context.fillStyle = "#fffdf7";
        context.strokeStyle = style.color;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(xFor(cell.parameterCount), yFor(cell.meanRatio), 3.5, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      });
    });

    if (chart.activeIndex >= 0 && chart.activeIndex < evidence.profiles.length) {
      const profile = evidence.profiles[chart.activeIndex];
      const x = xFor(profile.parameterCount);
      context.strokeStyle = "rgba(7,21,29,.42)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, plot.top);
      context.lineTo(x, plot.bottom);
      context.stroke();
    }
    return true;
  }

  function updateWidthCheckpoint(chart, index, announce) {
    const evidence = chart.evidence;
    const anchor = evidence.anchors[chart.anchorIndex];
    chart.activeIndex = Math.max(0, Math.min(evidence.profiles.length - 1, index));
    drawWidthScalingChart(chart);
    const profile = evidence.profiles[chart.activeIndex];
    const cells = evidence.corpusIds.map(function (corpusId) {
      return anchor.cells.find(function (cell) { return cell.variantId === profile.variantId && cell.corpusId === corpusId; });
    }).filter(Boolean);
    const message = profile.label + " · " + Number(profile.parameterCount).toLocaleString() + " parameters · " + fixedAnchorTokens(anchor.trainingTokens) + " tokens · " + cells.map(function (cell) {
      return cell.corpusLabel + " DNA/empty " + formatNumber(cell.meanRatio, 4) + " [" + formatNumber(cell.minRatio, 4) + "–" + formatNumber(cell.maxRatio, 4) + "]";
    }).join(" · ");
    chart.tooltip.textContent = message;
    chart.tooltip.hidden = false;
    const geometry = chart.geometry;
    const x = geometry ? geometry.xFor(profile.parameterCount) : 80;
    const maxLeft = Math.max(8, chart.canvas.clientWidth - 286);
    chart.tooltip.style.left = Math.max(8, Math.min(maxLeft, x - 135)) + "px";
    chart.tooltip.style.top = "40px";
    if (announce) chart.output.textContent = message;
  }

  function nearestWidthIndex(xPositions, targetX) {
    let nearest = 0;
    let distance = Infinity;
    xPositions.forEach(function (x, index) {
      const current = Math.abs(x - targetX);
      if (current < distance) {
        distance = current;
        nearest = index;
      }
    });
    return nearest;
  }

  function initializeWidthScalingChart(entry) {
    const evidence = entry.widthScalingEvidence;
    const figure = drawerContent.querySelector("[data-width-scaling]");
    if (!evidence || !figure) return;
    const canvas = figure.querySelector(".width-scaling-canvas");
    const tooltip = figure.querySelector(".width-scaling-tooltip");
    const output = figure.querySelector("output");
    const select = figure.querySelector("[data-width-anchor-select]");
    const details = figure.querySelector(".width-scaling-data");
    if (!canvas || !tooltip || !output || !select) return;
    const chart = {
      evidence: evidence,
      canvas: canvas,
      tooltip: tooltip,
      output: output,
      select: select,
      details: details,
      anchorIndex: Math.max(0, Math.min(evidence.anchors.length - 1, Number(select.value) || 0)),
      activeIndex: -1,
      observer: null,
      resizeHandler: null,
      geometry: null
    };
    if (!drawWidthScalingChart(chart)) {
      figure.classList.add("no-canvas");
      if (details) details.open = true;
      return;
    }
    const redraw = function () { window.requestAnimationFrame(function () { drawWidthScalingChart(chart); }); };
    if (typeof ResizeObserver === "function") {
      chart.observer = new ResizeObserver(redraw);
      chart.observer.observe(canvas);
    } else {
      chart.resizeHandler = redraw;
      window.addEventListener("resize", redraw);
    }
    const selectPointerWidth = function (event) {
      if (!chart.geometry) return;
      const rect = canvas.getBoundingClientRect();
      updateWidthCheckpoint(chart, nearestWidthIndex(chart.geometry.xPositions, event.clientX - rect.left), false);
    };
    canvas.addEventListener("pointermove", selectPointerWidth);
    canvas.addEventListener("pointerdown", function (event) {
      canvas.focus({ preventScroll: true });
      selectPointerWidth(event);
    });
    canvas.addEventListener("pointerleave", function () {
      if (document.activeElement !== canvas) {
        chart.activeIndex = -1;
        tooltip.hidden = true;
        drawWidthScalingChart(chart);
      }
    });
    canvas.addEventListener("focus", function () {
      updateWidthCheckpoint(chart, evidence.profiles.length - 1, true);
    });
    canvas.addEventListener("blur", function () {
      chart.activeIndex = -1;
      tooltip.hidden = true;
      drawWidthScalingChart(chart);
    });
    canvas.addEventListener("keydown", function (event) {
      let next = chart.activeIndex < 0 ? 0 : chart.activeIndex;
      if (event.key === "ArrowLeft") next -= 1;
      else if (event.key === "ArrowRight") next += 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = evidence.profiles.length - 1;
      else return;
      event.preventDefault();
      updateWidthCheckpoint(chart, next, true);
    });
    select.addEventListener("change", function () {
      chart.anchorIndex = Math.max(0, Math.min(evidence.anchors.length - 1, Number(select.value) || 0));
      chart.activeIndex = -1;
      tooltip.hidden = true;
      drawWidthScalingChart(chart);
      const anchor = evidence.anchors[chart.anchorIndex];
      output.textContent = "Training-token checkpoint changed to " + fixedAnchorTokens(anchor.trainingTokens) + " tokens, step " + anchor.step + ".";
    });
    activeCurveCharts.push(chart);
  }

  function drawJointScalingChart(chart) {
    const canvas = chart.canvas;
    const context = canvas.getContext && canvas.getContext("2d");
    if (!context || !chart.cell) return false;
    const cell = chart.cell;
    const points = cell.curve.points;
    const cssWidth = Math.max(1, Math.floor(canvas.getBoundingClientRect().width || 760));
    const cssHeight = 440;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(cssWidth * pixelRatio);
    const pixelHeight = Math.round(cssHeight * pixelRatio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.fillStyle = "#fffdf7";
    context.fillRect(0, 0, cssWidth, cssHeight);

    const horizontalMargin = Math.max(38, Math.min(58, cssWidth * 0.16));
    const rightMargin = Math.max(8, Math.min(18, cssWidth * 0.04));
    const plot = { left: horizontalMargin, right: cssWidth - rightMargin, top: 25, bottom: 282 };
    const ratioPlot = { left: plot.left, right: plot.right, top: 330, bottom: 398 };
    const allPpl = [cell.thresholdPpl];
    points.forEach(function (point) {
      allPpl.push(point.empty.minPpl, point.empty.maxPpl, point.gene.minPpl, point.gene.maxPpl);
    });
    const rawMin = Math.min.apply(null, allPpl);
    const rawMax = Math.max.apply(null, allPpl);
    const yMin = Math.max(0.25, rawMin * 0.9);
    const yMax = Math.max(yMin * 1.4, rawMax * 1.08);
    const logMin = Math.log(yMin);
    const logMax = Math.log(yMax);
    const xFor = function (fraction) { return plot.left + fraction * (plot.right - plot.left); };
    const yFor = function (ppl) {
      return plot.bottom - ((Math.log(ppl) - logMin) / (logMax - logMin)) * (plot.bottom - plot.top);
    };
    const ratioMin = Math.max(0.05, Math.min.apply(null, points.map(function (point) { return point.ratio.min; })) - 0.05);
    const ratioMax = Math.max(1.02, Math.max.apply(null, points.map(function (point) { return point.ratio.max; })) + 0.03);
    const ratioY = function (value) {
      return ratioPlot.bottom - ((value - ratioMin) / (ratioMax - ratioMin)) * (ratioPlot.bottom - ratioPlot.top);
    };
    chart.geometry = { plot: plot, ratioPlot: ratioPlot, xFor: xFor, yFor: yFor, ratioY: ratioY };

    context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.lineWidth = 1;
    context.strokeStyle = "#d6d3c9";
    context.fillStyle = "#667575";
    context.textAlign = "right";
    const logTickMin = Math.floor(Math.log10(yMin));
    const logTickMax = Math.ceil(Math.log10(yMax));
    const yTicks = [];
    for (let exponent = logTickMin; exponent <= logTickMax; exponent += 1) {
      [1, 2, 5].forEach(function (multiple) {
        const tick = multiple * Math.pow(10, exponent);
        if (tick >= yMin && tick <= yMax) yTicks.push(tick);
      });
    }
    if (yTicks.length < 2) yTicks.push(yMin, yMax);
    yTicks.forEach(function (tick) {
      const y = yFor(tick);
      context.beginPath();
      context.moveTo(plot.left, y);
      context.lineTo(plot.right, y);
      context.stroke();
      context.fillText(formatNumber(tick, tick < 10 ? 1 : 0), plot.left - 8, y + 3);
    });
    context.textAlign = "center";
    [0, 0.25, 0.5, 0.75, 1].forEach(function (fraction) {
      const x = xFor(fraction);
      context.beginPath();
      context.moveTo(x, plot.top);
      context.lineTo(x, ratioPlot.bottom);
      context.stroke();
      context.fillText(formatNumber(fraction * 100, 0) + "%", x, ratioPlot.bottom + 18);
    });
    context.save();
    context.translate(14, (plot.top + plot.bottom) / 2);
    context.rotate(-Math.PI / 2);
    context.fillText("Validation PPL · log scale", 0, 0);
    context.restore();
    context.fillText("Fraction of continuous corpus prefix consumed", (plot.left + plot.right) / 2, 431);
    context.textAlign = "left";
    context.fillText("Paired DNA / empty PPL", plot.left, ratioPlot.top - 10);

    function drawBand(lowAt, highAt, yScale, fillStyle) {
      context.beginPath();
      points.forEach(function (point, index) {
        const x = xFor(point.corpusFraction);
        const y = yScale(highAt(point));
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      points.slice().reverse().forEach(function (point) {
        context.lineTo(xFor(point.corpusFraction), yScale(lowAt(point)));
      });
      context.closePath();
      context.fillStyle = fillStyle;
      context.fill();
    }
    function drawLine(valueAt, yScale, color, dash, width) {
      context.beginPath();
      points.forEach(function (point, index) {
        const x = xFor(point.corpusFraction);
        const y = yScale(valueAt(point));
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = color;
      context.lineWidth = width;
      context.setLineDash(dash);
      context.stroke();
      context.setLineDash([]);
    }
    drawBand(function (point) { return point.empty.minPpl; }, function (point) { return point.empty.maxPpl; }, yFor, "rgba(94,105,106,.12)");
    drawBand(function (point) { return point.gene.minPpl; }, function (point) { return point.gene.maxPpl; }, yFor, "rgba(7,94,99,.13)");
    drawBand(function (point) { return point.ratio.min; }, function (point) { return point.ratio.max; }, ratioY, "rgba(7,94,99,.13)");
    drawLine(function (point) { return point.empty.geometricMeanPpl; }, yFor, "#5e696a", [7, 5], 2);
    drawLine(function (point) { return point.gene.geometricMeanPpl; }, yFor, "#075e63", [], 2.7);
    drawLine(function (point) { return point.ratio.geometricMean; }, ratioY, "#075e63", [], 2.4);

    const thresholdY = yFor(cell.thresholdPpl);
    context.strokeStyle = "#a25e05";
    context.lineWidth = 1.5;
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(plot.left, thresholdY);
    context.lineTo(plot.right, thresholdY);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#a25e05";
    context.textAlign = "right";
    context.fillText("threshold " + formatNumber(cell.thresholdPpl, 2), plot.right - 4, thresholdY - 5);

    context.strokeStyle = "#9ca5a2";
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(ratioPlot.left, ratioY(1));
    context.lineTo(ratioPlot.right, ratioY(1));
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#667575";
    context.fillText("1.0", ratioPlot.left - 8, ratioY(1) + 3);

    [
      { tokens: cell.geneMeanTokens, color: "#075e63", label: "DNA mean" },
      { tokens: cell.emptyMeanTokens, color: "#5e696a", label: "empty mean" }
    ].forEach(function (marker, index) {
      if (marker.tokens === null) return;
      const fraction = marker.tokens / cell.profile.transitionTokens;
      if (fraction < 0 || fraction > 1) return;
      const x = xFor(fraction);
      context.fillStyle = marker.color;
      context.beginPath();
      context.arc(x, thresholdY, 3.5, 0, Math.PI * 2);
      context.fill();
      context.textAlign = index === 0 ? "right" : "left";
      context.fillText(marker.label, x + (index === 0 ? -6 : 6), thresholdY + 15 + index * 11);
    });

    if (chart.activeIndex >= 0 && chart.activeIndex < points.length) {
      const point = points[chart.activeIndex];
      const x = xFor(point.corpusFraction);
      context.strokeStyle = "rgba(7,21,29,.38)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, plot.top);
      context.lineTo(x, ratioPlot.bottom);
      context.stroke();
      [
        { y: yFor(point.empty.geometricMeanPpl), color: "#5e696a" },
        { y: yFor(point.gene.geometricMeanPpl), color: "#075e63" },
        { y: ratioY(point.ratio.geometricMean), color: "#075e63" }
      ].forEach(function (marker) {
        context.fillStyle = "#fffdf7";
        context.strokeStyle = marker.color;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(x, marker.y, 4, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      });
    }
    return true;
  }

  function nearestJointPoint(points, targetFraction) {
    let nearest = 0;
    let distance = Infinity;
    points.forEach(function (point, index) {
      const current = Math.abs(point.corpusFraction - targetFraction);
      if (current < distance) {
        distance = current;
        nearest = index;
      }
    });
    return nearest;
  }

  function updateJointCheckpoint(chart, index, announce) {
    const points = chart.cell.curve.points;
    chart.activeIndex = Math.max(0, Math.min(points.length - 1, index));
    drawJointScalingChart(chart);
    const point = points[chart.activeIndex];
    const message = formatNumber(point.corpusFraction * 100, 1) + "% of prefix · " + compactTokens(point.trainingTokens) +
      " tokens · " + formatNumber(point.tokensPerParameter, 3) + " tokens/parameter · Empty PPL " +
      formatNumber(point.empty.geometricMeanPpl, 3) + " [" + formatNumber(point.empty.minPpl, 3) + "–" +
      formatNumber(point.empty.maxPpl, 3) + "] · DNA PPL " + formatNumber(point.gene.geometricMeanPpl, 3) + " [" +
      formatNumber(point.gene.minPpl, 3) + "–" + formatNumber(point.gene.maxPpl, 3) + "] · DNA/empty " +
      formatNumber(point.ratio.geometricMean, 3);
    chart.tooltip.textContent = message;
    chart.tooltip.hidden = false;
    const x = chart.geometry ? chart.geometry.xFor(point.corpusFraction) : 80;
    const maxLeft = Math.max(8, chart.canvas.clientWidth - 286);
    chart.tooltip.style.left = Math.max(8, Math.min(maxLeft, x - 135)) + "px";
    chart.tooltip.style.top = "38px";
    if (announce) chart.output.textContent = message;
  }

  function updateJointCell(chart, announce) {
    const cell = jointCellFor(chart.evidence, Number(chart.scaleSelect.value), chart.corpusSelect.value);
    if (!cell) return;
    chart.cell = cell;
    chart.activeIndex = -1;
    chart.tooltip.hidden = true;
    chart.cellSummary.innerHTML = jointCellSummaryMarkup(cell);
    chart.curveData.innerHTML = jointCurveDataTable(cell);
    drawJointScalingChart(chart);
    if (announce) {
      chart.output.textContent = Number(cell.profile.parameterCount).toLocaleString() + " parameters and " +
        Number(cell.profile.prefixLength).toLocaleString() + " corpus tokens selected; " + cell.corpus.label + ".";
    }
  }

  function initializeJointScalingChart(entry) {
    const evidence = entry.jointScalingEvidence;
    const figure = drawerContent.querySelector("[data-joint-scaling]");
    if (!evidence || !figure) return;
    const canvas = figure.querySelector(".joint-scaling-canvas");
    const tooltip = figure.querySelector(".joint-scaling-tooltip");
    const output = figure.querySelector("output");
    const corpusSelect = figure.querySelector("[data-joint-corpus-select]");
    const scaleSelect = figure.querySelector("[data-joint-scale-select]");
    const cellSummary = figure.querySelector("[data-joint-cell-summary]");
    const curveData = figure.querySelector("[data-joint-curve-data]");
    if (!canvas || !tooltip || !output || !corpusSelect || !scaleSelect || !cellSummary || !curveData) return;
    const chart = {
      evidence: evidence,
      cell: jointCellFor(evidence, Number(scaleSelect.value), corpusSelect.value),
      canvas: canvas,
      tooltip: tooltip,
      output: output,
      corpusSelect: corpusSelect,
      scaleSelect: scaleSelect,
      cellSummary: cellSummary,
      curveData: curveData,
      activeIndex: -1,
      observer: null,
      resizeHandler: null,
      geometry: null
    };
    if (!chart.cell || !drawJointScalingChart(chart)) {
      figure.classList.add("no-canvas");
      const details = curveData.querySelector("details");
      if (details) details.open = true;
      return;
    }
    const redraw = function () { window.requestAnimationFrame(function () { drawJointScalingChart(chart); }); };
    if (typeof ResizeObserver === "function") {
      chart.observer = new ResizeObserver(redraw);
      chart.observer.observe(canvas);
    } else {
      chart.resizeHandler = redraw;
      window.addEventListener("resize", redraw);
    }
    const selectPointerCheckpoint = function (event) {
      if (!chart.geometry) return;
      const rect = canvas.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - chart.geometry.plot.left) /
        (chart.geometry.plot.right - chart.geometry.plot.left)));
      updateJointCheckpoint(chart, nearestJointPoint(chart.cell.curve.points, fraction), false);
    };
    canvas.addEventListener("pointermove", selectPointerCheckpoint);
    canvas.addEventListener("pointerdown", function (event) {
      canvas.focus({ preventScroll: true });
      selectPointerCheckpoint(event);
    });
    canvas.addEventListener("pointerleave", function () {
      if (document.activeElement !== canvas) {
        chart.activeIndex = -1;
        tooltip.hidden = true;
        drawJointScalingChart(chart);
      }
    });
    canvas.addEventListener("focus", function () {
      updateJointCheckpoint(chart, chart.cell.curve.points.length - 1, true);
    });
    canvas.addEventListener("blur", function () {
      chart.activeIndex = -1;
      tooltip.hidden = true;
      drawJointScalingChart(chart);
    });
    canvas.addEventListener("keydown", function (event) {
      let next = chart.activeIndex < 0 ? 0 : chart.activeIndex;
      if (event.key === "ArrowLeft") next -= 1;
      else if (event.key === "ArrowRight") next += 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = chart.cell.curve.points.length - 1;
      else return;
      event.preventDefault();
      updateJointCheckpoint(chart, next, true);
    });
    corpusSelect.addEventListener("change", function () { updateJointCell(chart, true); });
    scaleSelect.addEventListener("change", function () { updateJointCell(chart, true); });
    activeCurveCharts.push(chart);
  }

  function signedPercent(value) {
    const number = numeric(value);
    if (number === null) return "—";
    return (number > 0 ? "+" : "") + formatNumber(number, 2) + "%";
  }

  function matrixCellTemplate(cell) {
    const selected = corpusFilter.value === cell.corpusId ? " matrix-selected" : "";
    const claim = cell.claim;
    if (!claim) {
      return '<td class="matrix-cell matrix-untested' + selected + '" data-status="none"><strong>Untested</strong><span>No paired claim</span><small>Not a 0% effect</small></td>';
    }
    const status = escapeHTML(claim.evidenceStatus);
    const threshold = claim.thresholdPpl === null ? "PPL threshold documented" : "PPL ≤ " + formatNumber(claim.thresholdPpl, claim.thresholdPpl % 1 ? 2 : 0);
    const hitLabel = claim.allThresholdHits ? "all threshold hits" : "threshold misses recorded";
    return '<td class="matrix-cell matrix-measured' + selected + '" data-status="' + status + '">' +
      '<span class="status status-' + status + '">' + escapeHTML(statusDisplay(claim.evidenceStatus)) + "</span>" +
      "<strong>" + escapeHTML(signedPercent(claim.meanImprovementPct)) + "</strong>" +
      "<span>" + escapeHTML(formatNumber(claim.baselineMeanSteps, 2)) + " → " + escapeHTML(formatNumber(claim.candidateMeanSteps, 2)) + " steps</span>" +
      "<small>" + escapeHTML(claim.pairedWins) + "/" + escapeHTML(claim.pairedRuns) + " positive · vs " + escapeHTML(claim.comparison) + " · " + escapeHTML(threshold) + " · " + escapeHTML(hitLabel) + "</small></td>";
  }

  function matrixTemplate(entry) {
    const rows = entry.matrixRows || [];
    if (!rows.length) {
      return '<div class="no-evidence-note"><strong>No compatibility matrix.</strong><p>This record does not declare compatible model variants.</p></div>';
    }
    const corpusCells = rows[0].cells || [];
    const headers = corpusCells.map(function (cell) {
      const selected = corpusFilter.value === cell.corpusId ? ' class="matrix-selected"' : "";
      return "<th scope=\"col\"" + selected + ">" + escapeHTML(cell.corpusLabel) + "</th>";
    }).join("");
    const body = rows.map(function (row) {
      const formattedParameters = row.parameterCount === null ? null : Number(row.parameterCount).toLocaleString();
      const parameters = formattedParameters === null || String(row.variantLabel).includes(formattedParameters)
        ? ""
        : "<small>" + escapeHTML(formattedParameters) + " parameters</small>";
      return '<tr><th scope="row"><span>' + escapeHTML(row.variantLabel) + "</span>" + parameters + "</th>" +
        row.cells.map(matrixCellTemplate).join("") + "</tr>";
    }).join("");
    const selectedCorpus = state.corporaById.get(corpusFilter.value);
    const context = selectedCorpus
      ? '<p class="matrix-context">Filtered corpus: <strong>' + escapeHTML(selectedCorpus.label) + '</strong>. The complete matrix remains visible.</p>'
      : '<p class="matrix-context">Every compatible model × corpus cell is shown. Untested means no claim exists; it never means a measured 0% effect.</p>';
    return context + '<div class="effect-matrix-wrap"><table class="effect-matrix"><caption>DNA effect coverage by compatible model and corpus</caption><thead><tr><th scope="col">Compatible model</th>' + headers + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }

  function claimTemplate(claim, options) {
    const showCurve = !options || options.showCurve !== false;
    const scoreClass = claim.passesAtlasGate ? "" : " fail";
    const gateLabel = claim.passesAtlasGate ? "passes 10% gate" : "below standalone gate";
    const modelLine = claim.model + " · " + claim.corpusLabel + " · compared with " + claim.comparison;
    const threshold = claim.thresholdPpl === null ? "documented PPL threshold" : "PPL ≤ " + formatNumber(claim.thresholdPpl, claim.thresholdPpl % 1 ? 2 : 0);
    return '<article class="claim-block"><div class="claim-head"><div><h4>' + escapeHTML(claim.label) + "</h4><p>" + escapeHTML(modelLine) + "</p></div>" +
      '<div class="claim-score' + scoreClass + '"><strong>' + escapeHTML(formatNumber(claim.meanImprovementPct, 2)) + '%</strong><span>' + escapeHTML(gateLabel) + "</span></div></div>" +
      convergenceCurveTemplate(claim, showCurve) + chartTemplate(claim.seeds || []) + tableTemplate(claim.seeds || []) +
      '<p class="card-secondary">Mean steps: ' + escapeHTML(formatNumber(claim.baselineMeanSteps, 2)) + " baseline → " + escapeHTML(formatNumber(claim.candidateMeanSteps, 2)) + " DNA · " + escapeHTML(claim.pairedWins) + "/" + escapeHTML(claim.pairedRuns) + " positive seeds · " + escapeHTML(threshold) + "</p></article>";
  }

  function evidenceClaimsTemplate(entry, isModel) {
    if (isModel) {
      return '<div class="no-evidence-note"><strong>No DNA effect claim.</strong><p>The smoke run establishes that this micro-model can train, evaluate, checkpoint, and generate on the project runtime. It does not measure PPL-convergence improvement.</p></div>';
    }
    const allClaims = entry.evidence || [];
    if (!allClaims.length) return "<p>No paired experiment is attached to this record.</p>";
    const directClaims = allClaims.filter(function (claim) { return claim.subjectId === entry.id; });
    const relatedClaims = allClaims.filter(function (claim) { return claim.subjectId !== entry.id; });
    const relatedSection = relatedClaims.length
      ? '<div class="evidence-group evidence-group-other"><h4>Related fragment evidence</h4><p class="evidence-group-note">Shown for recipe context only; these are not claims about the complete selected DNA record.</p>' + relatedClaims.map(function (claim) { return claimTemplate(claim, { showCurve: false }); }).join("") + "</div>"
      : "";
    const selectedCorpusId = corpusFilter.value;
    if (!selectedCorpusId) return directClaims.map(claimTemplate).join("") + relatedSection;

    const selectedCorpus = state.corporaById.get(selectedCorpusId) || {};
    const selectedCorpusLabel = valueFrom(selectedCorpus, ["label", "name"], selectedCorpusId);
    const selectedClaims = directClaims.filter(function (claim) { return claim.corpusId === selectedCorpusId; });
    const otherClaims = directClaims.filter(function (claim) { return claim.corpusId !== selectedCorpusId; });
    const selectedSection = selectedClaims.length
      ? '<div class="evidence-group evidence-group-selected"><h4>Selected corpus · ' + escapeHTML(selectedCorpusLabel) + '</h4><p class="evidence-group-note">These are the model-specific claims used for the selected-corpus status above.</p>' + selectedClaims.map(claimTemplate).join("") + "</div>"
      : '<div class="no-evidence-note"><strong>Untested on ' + escapeHTML(selectedCorpusLabel) + '.</strong><p>No model × corpus claim exists for this DNA on the selected corpus. The records below are evidence from other corpora and do not imply a 0% — or any measured — effect here.</p></div>';
    const otherSection = otherClaims.length
      ? '<div class="evidence-group evidence-group-other"><h4>Other-corpus evidence</h4><p class="evidence-group-note">Retained for full provenance; these claims do not determine the selected-corpus status.</p>' + otherClaims.map(claimTemplate).join("") + "</div>"
      : "";
    return selectedSection + otherSection + relatedSection;
  }

  function passportTemplate(passport) {
    if (!passport) return "<p>No passport is attached to this record.</p>";
    return '<dl class="passport">' + Object.entries(passport).map(function (pair) {
      return "<div><dt>" + escapeHTML(titleCase(pair[0])) + "</dt><dd>" + escapeHTML(pair[1]) + "</dd></div>";
    }).join("") + "</dl>";
  }

  function assuranceStatusLabel(status) {
    return {
      passed: "Passed",
      failed: "Failed",
      experimental: "Experimental",
      "not-applicable": "Not performed"
    }[status] || titleCase(status);
  }

  function assurancePassportTemplate(passport) {
    if (!passport || !passport.items || !passport.items.length) {
      return '<div class="no-evidence-note"><strong>No layered testing ledger is attached.</strong><p>This record cannot be presented as fully audited until its linked tests and controls are enumerated.</p></div>';
    }
    const counts = ASSURANCE_STATUSES.map(function (status) {
      return {
        status: status,
        count: passport.items.filter(function (item) { return item.status === status; }).length
      };
    }).filter(function (row) { return row.count > 0; });
    const summary = counts.map(function (row) {
      return '<span class="assurance-count assurance-' + escapeHTML(row.status) + '"><strong>' + escapeHTML(row.count) + '</strong> ' + escapeHTML(assuranceStatusLabel(row.status)) + '</span>';
    }).join("");
    const items = passport.items.map(function (item, index) {
      const nonHeldOutKind = (
        /(?:clean-room-empty-discovery|source-clean-room-search|one-generation.*search|component-panel-search-and-controls)/i.test(item.id || "")
        || /(?:search-only|empty-DNA discovery)/i.test(item.stage || "")
      )
        ? "search / non-held-out"
        : "protocol/control / non-held-out";
      const design = [
        item.performed ? "performed" : "not performed",
        !item.performed || item.heldOut === null ? null : (item.heldOut ? "held-out" : nonHeldOutKind),
        !item.performed || !item.seeds ? null : "seeds " + item.seeds,
        !item.performed || item.runCount === null ? null : item.runCount + " runs"
      ].filter(Boolean).join(" · ");
      const details = [
        ["Design", design],
        ["Control", item.control],
        ["Metric", item.metric],
        ["Evidence anchor", item.evidenceAnchor]
      ].filter(function (pair) { return pair[1]; }).map(function (pair) {
        return '<div><dt>' + escapeHTML(pair[0]) + '</dt><dd>' + escapeHTML(pair[1]) + '</dd></div>';
      }).join("");
      return '<li class="assurance-item assurance-' + escapeHTML(item.status) + '"><div class="assurance-marker" aria-hidden="true">' + escapeHTML(index + 1) + '</div><article><header><span class="assurance-status">' + escapeHTML(assuranceStatusLabel(item.status)) + '</span><h4>' + escapeHTML(item.stage) + '</h4></header>' +
        '<p class="assurance-result">' + escapeHTML(item.result || "No result claimed") + '</p><dl>' + details + '</dl></article></li>';
    }).join("");
    const openByDefault = passport.items.length <= 4 ? " open" : "";
    const ledgerLabel = passport.items.length === 1 ? "1 recorded check" : "all " + passport.items.length + " recorded checks";
    return '<div class="assurance-overview"><p><strong>Publication rule:</strong> search evidence is never treated as held-out validation; failed, experimental, and unperformed checks remain visible.</p><div class="assurance-counts">' + summary + '</div><p class="assurance-scope">' + escapeHTML(passport.scope) + '</p></div><details class="assurance-details"' + openByDefault + '><summary>Inspect ' + escapeHTML(ledgerLabel) + ', controls, breeding stages, and ablations</summary><ol class="assurance-ladder">' + items + '</ol></details>';
  }

  function openDrawer(entry, trigger) {
    cleanupCurveCharts();
    lastDrawerTrigger = trigger || document.activeElement;
    const isModel = entry.kind === "model";
    const view = entryView(entry);
    const snippet = entry.payload ? JSON.stringify(entry.payload, null, 2) : "No portable payload is attached to this record.";
    const claims = evidenceClaimsTemplate(entry, isModel);
    const evidenceLinks = arrayFrom(entry.evidenceLinks).slice().sort(function (left, right) {
      const selectedCorpus = corpusFilter.value;
      const leftSelected = selectedCorpus && arrayFrom(left.corpusIds).includes(selectedCorpus) ? 1 : 0;
      const rightSelected = selectedCorpus && arrayFrom(right.corpusIds).includes(selectedCorpus) ? 1 : 0;
      return rightSelected - leftSelected || left.label.localeCompare(right.label);
    });
    if (!evidenceLinks.length && entry.evidenceUrl) {
      evidenceLinks.push({ url: publishedEvidenceUrl(entry.evidenceUrl), label: entry.sourceLinkLabel || "Open public evidence catalog", corpusIds: [] });
    }
    const evidenceLink = evidenceLinks.length
      ? '<div class="drawer-evidence-links">' + evidenceLinks.map(function (link) {
        return '<a class="drawer-evidence-link" href="' + escapeHTML(link.url) + '">' + escapeHTML(link.label) + ' <span aria-hidden="true">↗</span></a>';
      }).join("") + "</div>"
      : "";
    const copyNoun = isModel ? "config" : entry.kind === "recipe" ? "recipe" : "gene";
    const copyButton = entry.payload
      ? '<button class="copy-button" type="button" data-copy-id="' + escapeHTML(entry.id) + '">Copy ' + copyNoun + " JSON</button>"
      : "";
    const drawerTags = arrayFrom(view.tags).slice(0, 3).map(function (tag) {
      return "<span>" + escapeHTML(tag) + "</span>";
    }).join("");
    const matrixSection = isModel ? "" : '<section class="drawer-section matrix-section"><h3>Model × corpus coverage</h3>' + matrixTemplate(entry) + "</section>";
    const assuranceSection = isModel ? "" : '<section class="drawer-section assurance-section"><h3>Layered testing, controls &amp; breeding record</h3>' + assurancePassportTemplate(entry.assurancePassport) + "</section>";
    const jointScalingSection = isModel ? "" : jointScalingTemplate(entry);
    const widthScalingSection = isModel ? "" : widthScalingTemplate(entry);
    drawerContent.innerHTML = '<header class="drawer-heading"><span class="status status-' + escapeHTML(view.status) + '">' + escapeHTML(statusDisplay(view.status)) + " · " + escapeHTML(titleCase(entry.kind)) + "</span>" +
      '<h2 id="detail-title">' + escapeHTML(entry.title) + '</h2><div class="card-tags drawer-tags">' + drawerTags + "</div><p>" + escapeHTML(entry.summary) + "</p>" +
      '<p class="drawer-status-note ' + escapeHTML(view.status) + '"><strong>Why this status:</strong> ' + escapeHTML(view.statusReason) + "</p></header>" +
      assuranceSection +
      matrixSection +
      jointScalingSection +
      widthScalingSection +
      '<section class="drawer-section"><h3>' + (isModel ? "Runnable model config" : "Portable DNA") + '</h3><div class="snippet-wrap">' + copyButton + "<pre><code>" + escapeHTML(snippet) + "</code></pre></div></section>" +
      '<section class="drawer-section"><h3>' + (isModel ? "DNA evidence boundary" : "Paired evidence") + "</h3>" + claims + "</section>" +
      '<section class="drawer-section"><h3>' + (isModel ? "Model passport" : "Evidence passport") + "</h3>" + passportTemplate(entry.passportForCorpus ? entry.passportForCorpus(corpusFilter.value || null) : entry.passport) + evidenceLink + "</section>";

    if (typeof drawer.showModal === "function") drawer.showModal();
    else drawer.setAttribute("open", "");
    document.body.classList.add("drawer-open");
    initializeCurveCharts(entry);
    drawerClose.focus();
  }

  function restoreDrawerFocus() {
    cleanupCurveCharts();
    document.body.classList.remove("drawer-open");
    const trigger = lastDrawerTrigger;
    lastDrawerTrigger = null;
    if (trigger && trigger.isConnected !== false && typeof trigger.focus === "function") trigger.focus();
  }

  function closeDrawer() {
    if (typeof drawer.close === "function") drawer.close();
    else drawer.removeAttribute("open");
    restoreDrawerFocus();
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("visible");
    toastTimer = window.setTimeout(function () { toast.classList.remove("visible"); }, 2200);
  }

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }

  async function copyEntry(entry) {
    if (!entry || !entry.payload) return;
    const text = JSON.stringify(entry.payload, null, 2);
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else if (!fallbackCopy(text)) throw new Error("Copy command unavailable");
      showToast((entry.kind === "model" ? "Model config" : entry.kind === "recipe" ? "Recipe" : "Gene") + " JSON copied");
    } catch (error) {
      showToast("Copy unavailable — select the JSON in the evidence drawer");
    }
  }

  async function loadCatalog() {
    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("Catalog request failed with " + response.status);
      const data = await response.json();
      state.corpora = catalogCorpora(data);
      state.corporaById = makeMap(state.corpora);
      state.entries = normalizeCatalog(data);
      if (!state.entries.length) throw new Error("Catalog contains no records");
      updateSummary(data);
      state.entries.sort(function (a, b) {
        const statusDelta = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
        return statusDelta || a.title.localeCompare(b.title);
      });
      state.byId = new Map(state.entries.map(function (entry) { return [entry.id, entry]; }));
      state.visible = state.entries.slice();
      initializeFilters();
      renderCards();
    } catch (error) {
      grid.setAttribute("aria-busy", "false");
      resultCount.textContent = "Static core record shown; interactive catalog unavailable";
      const notice = document.createElement("div");
      notice.className = "load-error";
      notice.innerHTML = "<strong>The live catalog could not be loaded.</strong><p>The verified core record below remains readable. Open this page through GitHub Pages or a local web server to enable filtering and evidence drawers.</p>";
      grid.before(notice);
    }
  }

  filterForm.addEventListener("input", applyFilters);
  filterForm.addEventListener("change", applyFilters);
  filterForm.addEventListener("submit", function (event) { event.preventDefault(); applyFilters(); });
  resetButton.addEventListener("click", function () { window.setTimeout(applyFilters, 0); });

  grid.addEventListener("click", function (event) {
    const detailButton = event.target.closest("[data-detail-id]");
    const copyButton = event.target.closest("[data-copy-id]");
    if (detailButton) openDrawer(state.byId.get(detailButton.dataset.detailId), detailButton);
    if (copyButton) copyEntry(state.byId.get(copyButton.dataset.copyId));
  });

  drawerContent.addEventListener("click", function (event) {
    const copyButton = event.target.closest("[data-copy-id]");
    if (copyButton) copyEntry(state.byId.get(copyButton.dataset.copyId));
  });
  drawerClose.addEventListener("click", closeDrawer);
  drawer.addEventListener("click", function (event) { if (event.target === drawer) closeDrawer(); });
  drawer.addEventListener("cancel", function (event) { event.preventDefault(); closeDrawer(); });
  drawer.addEventListener("close", restoreDrawerFocus);

  loadCatalog();
}());
