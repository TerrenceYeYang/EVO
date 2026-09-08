# Initialization DNA for Small GPT Models

**Manuscript Title:** Initialization DNA: Structured Weight-Space Interventions for Persistent Training Acceleration in a Small GPT Model  
**Author:** Terrence Yang (Independent Researcher, terrence.ye.yang@gmail.com)  
**Status:** Under peer review at *Neural Networks* (Elsevier, Manuscript Tracking ID: `NEUNET-D-26-08040`)

---

## 📄 Manuscript Access

- **[Download / View Manuscript PDF (12 pages)](./Initialization_DNA_Neural_Networks.pdf)** (or in [./pdf/Initialization_DNA_Neural_Networks.pdf](./pdf/Initialization_DNA_Neural_Networks.pdf))

---

## Abstract

Initialization is commonly treated as a neutral prelude to optimization once broad variance-preservation conditions are satisfied. In this work, we investigate structured weight-space interventions as inductive priors that accelerate early optimization dynamics in small neural language models. Specifically, we ask: can a compact, deterministic transformation of sampled parameters encode a reusable training advantage without changing architecture, optimizer, data order, or training budget? 

We represent such an intervention as an **initialization DNA**: an ordered list of target parameter groups, operations, scopes, and scalar values applied once before training. In a controlled case study on a compact three-block byte-level GPT (870,536 parameters), a recorded first mutation is replayed on the study model and independently clears a pre-specified acceleration gate on held-out seeds. Across 30 paired confirmatory seeds (150 complete training runs), the selected three-gene descendant reliably reduces mean steps to validation perplexity 7 from 1465.3 to 931.2 (a 36.5% reduction with non-overlapping bootstrap 95% confidence intervals) while improving final perplexity and normalized validation-loss area. Crucially, this early optimization prior exhibits a strong compositional effect with optimizer tuning: its advantage persists across six learning rates (retaining a measurable gain even under the best tuned rate) and extends through 5000 training steps over 20 paired seeds.

---

## Key Confirmatory Results (30 Paired Seeds / 150 Runs)

| Initialization Group | Steps to PPL 7 [95% CI] | Final PPL [95% CI] | AUC / Step |
| :--- | :--- | :--- | :--- |
| **Standard Baseline** | 1465.3 [1447.6, 1482.9] | 6.697 | 8.898 |
| **Seed-DNA (1 Gene)** | 1053.1 [1039.8, 1067.0] | 6.107 | 8.290 |
| **Selected-DNA (3 Genes)** | **931.2 [918.4, 944.1]** | **5.965** | **8.046** |

- **Early Convergence Acceleration:** 36.5% reduction in steps to target perplexity.
- **Optimizer Composition:** Advantage persists across six learning rates spanning an order of magnitude (even under optimal learning rate 2e-3).
- **Long-Horizon Persistence:** Over 20 paired seeds trained to 5000 steps, DNA maintains superior validation loss at every recorded checkpoint (unanimous sign-test  = 1.91 	imes 10^{-6}$).

---

## Exact 3-Gene Initialization DNA

The discovered three-gene transformation applied once before training step 0:
```json
[
  {
    "target": "layernorm.weight",
    "op": "scale",
    "layer": 2,
    "value": 1.7
  },
  {
    "target": "matrix_weight",
    "op": "scale",
    "layer": 2,
    "value": 1.370307
  },
  {
    "target": "attention_qkv.weight",
    "op": "scale",
    "layer": "all",
    "value": 1.271719
  }
]
```
