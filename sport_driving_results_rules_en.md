# Swedish Sport Driving Result Calculation Rules (TR V 2025) — Program Specification

> Purpose: This document defines a practical rule and data specification for software that calculates and displays live results for Swedish sport driving competitions (`sportkörning`) under the 2025 Swedish Equestrian Federation rules. It is written for developers building result reporting, live scoring, partial result views, rankings, placings, and qualification-related validations.
>
> Scope: complete competitions with dressage, marathon and cones/precision, plus individual phases. Classes include horse and pony, all turnouts, children, Ch, junior, U25, para, Lätt B, Lätt A, Medelsvår and Svår.
>
> Important: this specification is a software interpretation of the uploaded TR V 2025 and TR I 2025 documents. The official rule documents and later updates always take precedence.

---

## 1. Core concepts

### 1.1 Competition phases

A complete sport driving competition consists of three phases:

1. **Dressage** (`DRESSAGE`)
2. **Marathon** (`MARATHON`)
3. **Precision / cones** (`PRECISION`)

Each phase produces penalty points. The competitor with the lowest penalty points wins the phase. In a complete competition, phase penalties are added and the competitor with the lowest total penalty wins.

Individual phase competitions may also be run. In that case, prizes and placings are calculated per phase.

### 1.2 Turnouts

Supported turnout types:

| Code | English name | Swedish name | Notes |
|---|---|---|---|
| `SINGLE` | Single | Enbet | Horse or pony. |
| `PAIR` | Pair | Par | Horse or pony. |
| `TANDEM` | Tandem | Tandem | Horse or pony. |
| `FOUR_IN_HAND` | Four-in-hand | Fyrspann | Horse or pony. |

### 1.3 Animal categories

Supported animal groups:

| Code | Description |
|---|---|
| `HORSE` | Horse. |
| `PONY_A` | Pony category A. |
| `PONY_B` | Pony category B. |
| `PONY_C` | Pony category C. |
| `PONY_D` | Pony category D. |
| `PONY_CD` | Combined category C/D where a rule table combines them. |
| `PONY_ANY` | Any pony category where category is not relevant. |

Pony categories are relevant for marathon speeds and carriage tables. In code, store both the exact pony category and any merged display class.

### 1.4 Difficulty levels and competition status

| Difficulty | Code | Complete one-day | Complete multi-day | Individual phases |
|---|---:|---:|---:|---:|
| Lätt B | `LB` | 1* | 1* | 1* |
| Lätt A | `LA` | 1* | 2* | 1* |
| Medelsvår | `MSV` | 1* | 3* | 1* |
| Svår | `SVAR` | Not arranged as one-day complete | 4* or 5* | 1* |
| Swedish Championship | `SM` | Not arranged as one-day complete | 5* | Not arranged |

Svår with prize money in a complete multi-day competition is a 5* competition. SM is a 5* complete competition.

### 1.5 Class variants

Use this class variant field in addition to difficulty:

| Code | Meaning |
|---|---|
| `OPEN` | Ordinary open class. |
| `BARN` | Children class. Always own class; not merged with other classes. |
| `CH` | Children category. |
| `J` | Junior. |
| `U25` | U25. |
| `PARA` | Para. |

A recommended unique class key is:

```text
competition_id + difficulty + variant + animal_group + turnout + optional_merged_group
```

Examples:

```text
2025-001_LA_OPEN_HORSE_SINGLE
2025-001_MSV_PARA_PONY_ANY_SINGLE
2025-001_LB_BARN_PONY_A_SINGLE
2025-001_SVAR_OPEN_HORSE_FOUR_IN_HAND
```

---

## 2. Result statuses and continuation rules

### 2.1 Status codes

| Code | Swedish term | English meaning | Ranking effect |
|---|---|---|---|
| `OK` | Godkänt/fullföljt | Completed with a numeric result | Eligible for phase ranking and, if all phases are OK, total ranking. |
| `A` | Avstängning | Suspended | No placing; may not continue in the competition. |
| `U` | Utesluten | Eliminated | No placing in that phase; not eligible for total result. If eliminated in dressage or marathon, the competitor may start precision unless other rule/status prevents it. |
| `UG` | Utgått | Retired/withdrawn during phase | No placing in that phase; may be allowed to start another phase, but no total result. |
| `S` | Strukit sig | Scratched/non-starter in a phase | Cannot continue the competition; no total result. |
| `START_FORBIDDEN` | Startförbud | Start forbidden | Must not start until resolved; no result if not resolved. |

### 2.2 Total-result eligibility

A competitor is eligible for the total result only if all required phases are `OK`.

```pseudo
eligible_for_total = dressage.status == OK
                  && marathon.status == OK
                  && precision.status == OK
```

If a competitor is `A`, `U`, `UG` or `S` in any phase, do not include them in total ranking. Show the status in the general protocol / overall result list.

### 2.3 Moment-result eligibility

For an individual phase ranking, include only competitors with `status == OK` in that phase. Show non-finishers below the ranked results with their status and reason.

---

## 3. Dressage scoring

### 3.1 Input data

For each dressage start, store:

```yaml
dressage_result:
  program_id: string
  max_points: decimal
  judges:
    - judge_id: string
      total_points: decimal
  c_judge_penalties:
    wrong_course_penalties: decimal
    other_penalties: decimal
  status: OK | A | U | UG | S | START_FORBIDDEN
  status_reason: string | null
```

### 3.2 Judge scoring scale

Each numbered movement and collective mark is scored from 0 to 10. Half-points are allowed.

### 3.3 Dressage penalty formula

If the program has ordinary Swedish scoring:

```pseudo
average_points = sum(judge.total_points for judge in judges) / count(judges)
base_penalties = max_points - average_points
dressage_penalties = base_penalties + c_judge_penalties.total
```

If the program is a FEI program with a specific conversion instruction, use that program-specific conversion instead of the generic `max_points - average_points` formula.

Display dressage penalty points with **two decimals**.

```pseudo
dressage_penalties_display = round_to_2_decimals(dressage_penalties)
```

### 3.4 Dressage ranking

Sort all `OK` competitors by:

1. lowest `dressage_penalties`
2. if still tied, treat as equal unless the proposition or competition-specific rule defines another tie-breaker.

### 3.5 Dressage penalties and elimination events

| Event | Penalty/status |
|---|---:|
| Missing lamps in Svår dressage | 5 penalties |
| Whip not in hand or too short | 10 penalties |
| Unauthorized assistance | Eliminated (`U`) |
| Groom communicates with driver in dressage, except Barn and Lätt B clear round | 10 penalties |
| Unauthorized communication equipment | Eliminated (`U`) |
| Does not meet function check requirements | Start forbidden |
| Boots/bandages at function check | 10 penalties |
| Does not start within 90 seconds | Possibly eliminated; requires official decision |
| Wrong course, first time | 5 penalties |
| Wrong course, second time | 10 penalties |
| Wrong course, third time | Eliminated (`U`) |
| Whole turnout leaves arena | Eliminated (`U`) |
| Part of turnout leaves arena or arena fence is knocked down | Deduction according to wrong-course/incorrect-route handling |
| Groom dismounts, first time | 5 penalties |
| Groom dismounts, second time | 10 penalties |
| Groom dismounts, third time | Eliminated (`U`) |
| Disobedience, first time | 5 penalties |
| Disobedience, second time | 10 penalties |
| Disobedience, third time | Eliminated (`U`) |
| Lame horse | Eliminated (`U`) from further participation |
| Boots/bandages during dressage | 10 penalties |

---

## 4. Marathon scoring

### 4.1 Marathon sections

Marathon can include:

| Section | Code | Notes |
|---|---|---|
| Warm-up area | `WU` | May replace A section. Treated as A-section equivalent for rules. |
| A section | `A` | Not used in complete one-day competitions. Minimum length 3 km where used. |
| Pause | `PAUSE` | 5 minutes after WU, or 5–10 minutes after A section. |
| B section | `B` | Always used in marathon. Includes obstacles. |
| Cool down | `COOL_DOWN` | Optional, after B. |

In two- or three-day competitions, marathon uses two sections for all classes except `BARN`, where only section B is used. In complete one-day competitions, only section B is used for all classes.

### 4.2 Marathon speed table

Speeds are in km/h. Pony columns `A`, `B`, `C/D` refer to pony categories; `H` is horse.

| Difficulty / variant | A section pony A | A section pony B | A section pony C/D | A section horse | B section pony A | B section pony B | B section pony C/D | B section horse |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Lätt B Para | 10.0 | 10.5 | 11.0 | 12.0 | 8.5 | 9.0 | 9.5 | 10.5 |
| Lätt B | 10.0 | 10.5 | 11.0 | 12.0 | 9.0 | 9.5 | 10.0 | 11.0 |
| Lätt A Para | 11.0 | 11.5 | 12.0 | 13.0 | 9.0 | 9.5 | 10.0 | 11.0 |
| Lätt A | 11.0 | 11.5 | 12.0 | 13.0 | 10.0 | 10.5 | 11.0 | 12.0 |
| Medelsvår Para | 12.0 | 12.5 | 13.0 | 14.0 | 10.0 | 10.5 | 11.0 | 12.0 |
| Medelsvår | 12.0 | 12.5 | 13.0 | 14.0 | 11.0 | 11.5 | 12.0 | 13.0 |
| Svår Para | 12.5 | 13.5 | 14.0 | 15.0 | 10.5 | 11.5 | 12.0 | 13.0 |
| Svår | 12.5 | 13.5 | 14.0 | 15.0 | 11.5 | 12.5 | 13.0 | 14.0 |

### 4.3 Marathon max lengths and obstacle counts

| Class | WU | A max, complete one-day | B max, complete one-day | B max, multi-day | Total A+B max, multi-day | Obstacles one-day | Obstacles multi-day | Max gates |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Lätt B Barn | - / 10 min | - | 4 km | 5 km | 5 km | 3 | 3–4 | A–D |
| Lätt B | 20 min | 4 km | 4 km | 5 km | 8 km | 3–4 | 3–4 | A–D |
| Lätt A Barn | 20 min | - | 4 km | 5 km | 8 km | 3–4 | 3–4 | A–D |
| Lätt A Ch | 20 min | 4 km | 4 km | 5 km | 8 km | 3–4 | 3–4 | A–D |
| Lätt A J/U25 | 20 min | 7 km | 5 km | 7 km | 12 km | 3–4 | 4–6 | A–E |
| Lätt A | 20 min | 7 km | 5 km | 7 km | 12 km | 3–4 | 4–6 | A–E |
| Medelsvår Ch | 20 min | 4 km | 4 km | 6 km | 10 km | 4 | 4–5 | A–D |
| Medelsvår Para | 20 min | 6 km | 5 km | 7 km | 13 km | 4–5 | 5–6 | A–E |
| Medelsvår J/U25 | 20 min | 8 km | 6 km | 8 km | 15 km | 4–5 | 5–6 | A–F |
| Medelsvår | 20 min | 8 km | 6 km | 8 km | 15 km | 4–5 | 5–7 | A–F |
| Svår Para | 20 min | 6 km | - | 8 km | 13 km | - | 5–6 | A–F |
| Svår | 20 min | 9 km | - | 9 km | 18 km | - | 6–8 | A–F |

### 4.4 Section time calculation

For each timed section:

```pseudo
max_time_seconds = section_distance_km / speed_kmh * 3600
```

Minimum times:

```pseudo
min_time_A_seconds = max_time_A_seconds - 180
min_time_B_seconds = max_time_B_seconds - 120
```

Time limits:

```pseudo
time_limit_A_seconds = max_time_A_seconds * 1.20
time_limit_B_seconds = max_time_B_seconds * 2.00
```

### 4.5 Section time penalties

For A and B:

```pseudo
if actual_time_seconds < min_time_seconds:
    time_penalty = (min_time_seconds - actual_time_seconds) * 0.25
else if actual_time_seconds > max_time_seconds:
    time_penalty = (actual_time_seconds - max_time_seconds) * 0.25
else:
    time_penalty = 0
```

If `actual_time_seconds > time_limit_seconds`, status is `U`.

### 4.6 Gait rules

| Situation | Rule |
|---|---|
| Lätt B | Only walk and trot are allowed in all phases and in the competition area. Intentional canter = eliminated. |
| Lätt A, Medelsvår, Svår | Free gait on all marathon sections. |
| Last 300 m of B section | Only walk and trot are allowed. Intentional canter = eliminated. |
| Wrong gait, if not corrected within 5 seconds | 1 penalty per started 5-second period. |

### 4.7 Obstacle time penalties

For each marathon obstacle:

```pseudo
obstacle_time_penalty = obstacle_time_seconds * 0.25
```

The obstacle time limit is 5 minutes. If the competitor has not passed all required gates and left through the exit flags within 5 minutes, status is `U`.

For **Lätt B clear round**, obstacle time does not give penalties if each obstacle is completed within 5 minutes.

### 4.8 Marathon total formula

```pseudo
marathon_penalties = section_time_penalties
                   + obstacle_time_penalties
                   + obstacle_fault_penalties
                   + route_penalties
                   + equipment_and_other_penalties
```

Display with two decimals:

```pseudo
marathon_penalties_display = round_to_2_decimals(marathon_penalties)
```

### 4.9 Marathon ranking and ties

Sort `OK` competitors by:

1. lowest `marathon_penalties`
2. lowest penalty points on B section
3. if still tied, equal placing unless the proposition defines another tie-breaker.

### 4.10 Marathon penalties and elimination events

| Event | Penalty/status |
|---|---:|
| Driver or groom missing required helmet and body protector/back protector | Start forbidden or eliminated |
| Horse unshod in marathon | Start forbidden or eliminated |
| Driver does not stop when ordered by president of ground jury/judge | Eliminated |
| Driver stopped by president of ground jury/judge | Written warning |
| Deviates more than 10 m from indicated route | 10 penalties |
| Motor vehicle or bicycle in obstacle, first/second time | Written warning / fine |
| Intentional canter where not allowed | Eliminated |
| Wrong gait | 1 penalty per 5 seconds |
| Each second under minimum time on A or B | 0.25 penalties per second |
| Each second over maximum time on A or B | 0.25 penalties per second |
| Over section time limit | Eliminated |
| Driver dismounts except in pause | 20 penalties per occasion + written warning |
| Groom dismounts except at halt for repair or in pause | 5 penalties per occasion |
| Driver and groom both leave carriage at the same time on section or in obstacle | Eliminated |
| Driver or groom dismounts more than 30 m from last obstacle for repair | 10 penalties |
| Stops without reason | 1 penalty per 10 seconds |
| Groom not on carriage at start, finish or compulsory gate | 10 penalties |
| Compulsory gates or obstacles not passed in correct order | Eliminated |
| Route deviation | 10 penalties per occasion |
| Whip missing from carriage | 5 penalties |
| Groom change | Eliminated |
| Finish with fewer horses than at start, missing wheel, etc. | Eliminated |
| Knockdown of breakable element | 2 penalties per element |
| Preventing breakable element from falling | 10 penalties |
| Time used in obstacle | 0.25 penalties per second |
| Obstacle time limit exceeded | Eliminated |
| Gate passed in wrong order in obstacle | Eliminated |
| Wrong route in obstacle, corrected | 20 penalties |
| Exit flags passed without completing obstacle | Eliminated |
| Horse(s) unhitched in obstacle | Eliminated |
| Failure to correct dangerous horse situation | 30 penalties |
| Groom climbs on shaft/pole or over horse | 20 penalties |
| Turnout not halted for groom mounting/dismounting where required | 5 penalties per occasion |

---

## 5. Precision / cones scoring

### 5.1 Assessment methods

| Code | Swedish term | Software behavior |
|---|---|---|
| `CLEAR_ROUND` | Clear round | No ranking. Rosette if no obstacle penalties and within time requirements. |
| `A0` | A:0 | One round. Lowest penalties wins; if equal, fastest time wins. If penalties and time are equal, equal placing. |
| `A_TWO_PHASES` | A med två faser | Competitors with zero penalties in phase 1 continue directly to phase 2. Phase 2 determines ranking. If nobody is clear in phase 1, phase 1 penalties and time determine ranking. |
| `TIME_COMPETITION` | Tidstävling precision | Penalties are converted to penalty seconds and added to driving time. Lowest total time wins. |
| `POINTS_HUNT` | Poängjakt precision | Highest points wins; if configured, fastest time after time-control obstacle breaks ties. |

### 5.2 Precision speed, cone width and maximum obstacle table

Speeds are in m/min. `Width +` is added to the carriage track width unless the class uses fixed standard widths.

| Class | Pony phase 1 | Pony phase 2 | Horse phase 1 | Horse phase 2 | Width + | Max obstacles CR/A:0 | Max obstacles two phases |
|---|---:|---:|---:|---:|---:|---:|---:|
| LB Barn | 100 | - | - | - | 45 cm | 12 | - |
| LB | 160 | - | 180 | - | 35 cm | 20 | 24 |
| LA Barn | 180 | - | - | - | 45 cm | 15 | - |
| LA Ch | 180 | - | - | - | 45 cm | 15 | - |
| LA J/U25 | 200 | 210 | 210 | 220 | 30 cm | 20 | 24 |
| LA | 200 | 210 | 210 | 220 | 30 cm | 20 | 24 |
| MSV Para | 210 | 220 | 220 | 230 | 25 cm | 20 | 24 |
| MSV Ch | 230 | - | - | - | 40 cm | 15 | - |
| MSV J/U25 | 230 | 240 | 230 | 240 | 25 cm | 20 | 24 |
| MSV | 230 | 240 | 230 | 240 | 25 cm | 20 | 24 |
| Svår Para | 230 | 230 | 230 | 230 | 20 cm fixed/standard | 20 | 24 |
| Svår J/U25 | 260 | 260 | 250 | 250 | 20 cm | 20 | 24 |
| Svår single | 260 | 260 | 250 | 250 | 20 cm fixed/standard | 20 | 24 |
| Svår pair | 250 | 250 | 250 | 250 | 20 cm fixed/standard | 20 | 24 |
| Svår four-in-hand | 240 | 240 | 240 | 240 | 25 cm fixed/standard | 20 | 24 |

Special notes:

- Four-in-hand in LB, LA and MSV has 10 cm wider cone spacing than single turnouts.
- Pony four-in-hand uses the same cone-pair distance as pony pairs in zig-zag and wave obstacles.
- In Svår, obstacle width is the standard width based on required carriage measurements.
- Children classes have special time handling: no normal maximum-time penalty is applied; instead, the time limit is calculated from 100 m/min where stated, and exceeding the time limit causes elimination.

### 5.3 Allowed time and time limit

For normal precision classes:

```pseudo
allowed_time_seconds = course_length_m / speed_m_per_min * 60

time_limit_seconds = allowed_time_seconds * 2
```

For `BARN` classes with no normal maximum-time penalties:

```pseudo
child_time_limit_seconds = course_length_m / 100 * 60
if actual_time_seconds > child_time_limit_seconds:
    status = U
else:
    time_penalty = 0
```

### 5.4 Precision time penalties

For normal classes:

```pseudo
if actual_time_seconds > allowed_time_seconds:
    time_penalty = (actual_time_seconds - allowed_time_seconds) * 0.5
else:
    time_penalty = 0
```

If `actual_time_seconds > time_limit_seconds`, status is `U`.

Display precision penalties with two decimals.

### 5.5 Obstacle and fault penalties

| Event | Penalty/status |
|---|---:|
| Whip not in hand or too short | 10 penalties |
| Unauthorized communication equipment | Eliminated |
| Lätt B child driver exceeds allowed precision time | Eliminated |
| Driver does not salute judge | Verbal warning |
| Does not start within 45 seconds after signal | 5 penalties |
| Has not entered arena and crossed start within 45 seconds | Eliminated |
| Does not pass start and/or finish | Eliminated |
| Drives through start and first obstacle before start signal | 10 penalties and restart after signal |
| Drives through obstacle after finish | Written warning / fine |
| Over allowed time | 0.5 penalties per second |
| Over time limit, double allowed time | Eliminated |
| Wrong course | Eliminated |
| Ball(s) knocked down or part of multiple obstacle knocked down, including after obstacle has been driven | 3 penalties |
| Knockdown due to disobedience | 5 penalties + 10 seconds |
| Disobedience, first time | 5 penalties |
| Disobedience, second time | 10 penalties |
| Disobedience, third time | Eliminated |
| Knocks down part of obstacle still to be driven | 3 penalties + 10 seconds |
| Passes through an obstacle already driven | Eliminated |
| Grooming the carriage, first time | 5 penalties |
| Grooming the carriage, second time | 10 penalties |
| Grooming the carriage, third time | Eliminated |
| Groom dismounts | 5 penalties per occasion |
| Measured-too-narrow gate was driven and knocked | Knockdown penalties for incorrectly measured gates are removed |
| Driver claims wrongly measured gate, but measurement is correct | Original faults remain + 3 penalties |

### 5.6 Precision ranking

#### Clear round

No ranking. A competitor receives a clear-round rosette if:

```pseudo
status == OK
&& obstacle_penalties == 0
&& time_penalties == 0
&& not eliminated
```

For Lätt B clear round, check the special class criteria in section 7.1.

#### A:0

Sort by:

1. lowest total penalties
2. fastest actual time
3. equal placing if both penalties and time are equal.

#### A with two phases

If one or more competitors are clear in phase 1 and continue to phase 2:

1. rank phase-2 competitors by lowest phase-2 penalties
2. if equal, fastest phase-2 time
3. competitors not reaching phase 2 are ranked after phase-2 competitors by phase-1 penalties and time.

If no competitor is clear in phase 1:

1. rank all by lowest phase-1 penalties
2. if equal, fastest phase-1 time.

---

## 6. Total result calculation

### 6.1 Formula

Only competitors eligible under section 2.2 are included.

```pseudo
total_penalties = dressage_penalties
                + marathon_penalties
                + precision_penalties_for_total
```

For a two-phase precision class in a complete competition, use **precision penalties from phase 1** in the total result.

```pseudo
precision_penalties_for_total = precision.phase1_penalties
```

For ordinary A:0 or clear round precision in complete competition:

```pseudo
precision_penalties_for_total = precision.total_penalties
```

Display total with two decimals.

### 6.2 Total ranking and ties

Sort by:

1. lowest `total_penalties`
2. lowest `marathon_penalties`
3. lowest `dressage_penalties`
4. if still tied, equal placing unless the proposition defines another tie-breaker.

---

## 7. Class-specific rules

### 7.1 Lätt B clear round

Lätt B can be arranged as clear round or assessment A.

For `LB` with `CLEAR_ROUND`:

- Competitors are not ranked.
- Dressage clear-round criterion: maximum 80 penalty points.
- Marathon clear-round criterion: 0 penalties.
- Precision clear-round criterion: 0 penalties.
- Time in marathon obstacles does not give penalties, provided every obstacle is completed within 5 minutes.

```pseudo
lb_clear_round_dressage = dressage_penalties <= 80
lb_clear_round_marathon = marathon_penalties == 0
lb_clear_round_precision = precision_penalties == 0
```

### 7.2 Lätt B assessment A

Competitors are ranked and placed. Lätt B gait restriction applies: canter is forbidden in all phases and in the whole competition area.

### 7.3 Barn classes

Rules to encode:

- Barn classes are always separate classes and must not be merged with other classes.
- Barn classes may be arranged in Lätt B clear round, Lätt B assessment A, and Lätt A.
- In Lätt A Barn, canter is not allowed in any phase or anywhere in the competition area.
- Groom may read the dressage program.
- Groom may hold the rein ends behind the driver's hands.
- Groom may handle the whip and show the route in all phases.
- In precision, Barn drivers have no normal maximum time; elimination occurs if the calculated time limit is exceeded.
- All starting Barn drivers receive a rosette.

### 7.4 Team competitions

For a team result, only use a competitor if the competitor completed the competition without elimination in any phase.

```pseudo
team_eligible = dressage.status == OK
             && marathon.status == OK
             && precision.status == OK
```

The proposition must define the team scoring aggregation if not otherwise fixed.

---

## 8. Placings, prizes and rosettes

### 8.1 Number of placed competitors

Placings are calculated per class/category. The number depends on the number of starters:

| Starters | Placed competitors |
|---:|---:|
| 2–4 | 1 |
| 5–8 | 2 |
| 9–12 | 3 |
| 13–16 | 4 |
| Then | +1 placed per additional started group of 4 |

Software formula:

```pseudo
if starters < 2:
    placed_count = 0
else:
    placed_count = ceil(starters / 4)
```

A class requires at least two starters to count as a competition class. If only one starter remains and merging cannot be done, results may be registered but without placing and points.

To be placed, a competitor must have completed the class.

### 8.2 Starter count

For a complete competition, a competitor is counted as started when the turnout enters the dressage arena.

For individual phases:

| Phase | Started when |
|---|---|
| Dressage | Enters the dressage arena. |
| Marathon | Starts the first marathon section. |
| Precision | Passes the start line. |

### 8.3 Tied placings and prizes

If competitors are equal under the applicable ranking rules, they are tied. For prize money and points, tied placings should be handled according to the general rule: sum the tied prizes/points and divide equally among tied competitors. Draw lots for honour prizes if needed.

---

## 9. Class creation and merging

### 9.1 Separate class formation

Class dimensions:

```yaml
class_dimensions:
  - difficulty
  - variant
  - animal_group
  - turnout
```

At least two competitors are required to form a separate class/category.

### 9.2 Merging classes

If a class has only one starter, the organiser decides how classes are merged, except:

- Barn class must not be merged with any other class.
- In Lätt B and Lätt A, organiser may publish classes by turnout, with ponies and horses in the same class.
- In merged classes, all competitors must drive the same dressage program, while marathon and precision use each competitor's own tempo.
- Any deviation from the rules requires approval from the Swedish Equestrian Federation.

Software implication: ranking groups and technical parameter groups are not always identical.

```yaml
ranking_group_id: string      # merged class for ranking and placings
technical_profile_id: string  # individual tempo, width and course requirements
```

---

## 10. Qualification checks relevant to result software

This document is mainly about result calculation, but result systems should store qualification-relevant values.

### 10.1 Qualification result thresholds

A qualifying result requires:

| Phase | Threshold |
|---|---:|
| Dressage in Lätt B and Lätt A | Maximum 80 penalties |
| Dressage in Medelsvår | Maximum 70 penalties |
| Marathon | Completed without elimination |
| Precision | Maximum 20 penalties |

The marathon and precision criteria apply in all classes.

### 10.2 Separate phase qualification

Before starting marathon as an individual phase, the driver must be able to show a dressage protocol with no more than 80 penalties in at least the class they intend to start. That dressage qualification is valid for 12 months. Two approved marathons per difficulty level are required to qualify for a higher class.

Store these fields for future qualification modules:

```yaml
qualification_record:
  driver_id: string
  horse_id: string
  class_level: LB | LA | MSV | SVAR
  turnout: SINGLE | PAIR | TANDEM | FOUR_IN_HAND
  date: date
  dressage_penalties: decimal | null
  marathon_completed_without_elimination: boolean
  precision_penalties: decimal | null
  is_qualifying: boolean
```

---

## 11. Recommended calculation data model

### 11.1 Competition

```yaml
competition:
  id: string
  name: string
  start_date: date
  end_date: date
  status: 0_star | 1_star | 2_star | 3_star | 4_star | 5_star | invitation | club
  phases:
    dressage: boolean
    marathon: boolean
    precision: boolean
  complete_competition: boolean
```

### 11.2 Class

```yaml
class:
  id: string
  competition_id: string
  name: string
  difficulty: LB | LA | MSV | SVAR | SM
  variant: OPEN | BARN | CH | J | U25 | PARA
  animal_group: HORSE | PONY_A | PONY_B | PONY_C | PONY_D | PONY_CD | PONY_ANY | MIXED
  turnout: SINGLE | PAIR | TANDEM | FOUR_IN_HAND | MIXED
  assessment:
    dressage_program_id: string
    precision_method: CLEAR_ROUND | A0 | A_TWO_PHASES | TIME_COMPETITION | POINTS_HUNT
  ranking_group_id: string
  technical_profile_id: string
```

### 11.3 Competitor/start

```yaml
start:
  id: string
  class_id: string
  start_number: string
  driver_id: string
  groom_ids: [string]
  horse_ids: [string]
  reserve_horse_ids: [string]
  turnout: SINGLE | PAIR | TANDEM | FOUR_IN_HAND
  animal_category: HORSE | PONY_A | PONY_B | PONY_C | PONY_D
  carriage_track_width_cm: decimal | null
  status_overall: OK | A | U | UG | S | START_FORBIDDEN | null
```

### 11.4 Phase result

```yaml
phase_result:
  start_id: string
  phase: DRESSAGE | MARATHON | PRECISION
  status: OK | A | U | UG | S | START_FORBIDDEN
  status_reason_code: string | null
  numeric_penalties: decimal | null
  display_penalties: string | null
  rank: integer | null
  is_placed: boolean
  is_clear_round: boolean | null
```

### 11.5 Audit trail

Every manual penalty/status change should be auditable:

```yaml
result_event:
  id: string
  start_id: string
  phase: DRESSAGE | MARATHON | PRECISION | OVERALL
  source: JUDGE | TIMEKEEPER | OBSTACLE_STAFF | SECRETARIAT | SYSTEM
  rule_reference: string
  description: string
  penalty_delta: decimal | null
  status_set: string | null
  created_at: datetime
  created_by: string
```

---

## 12. Live result display requirements

### 12.1 Phase views

Each phase view should show:

- class/ranking group
- start number
- driver
- horse(s)
- turnout
- raw time or judge points where applicable
- penalties by component
- total phase penalties
- status
- rank
- placing marker

### 12.2 Overall view

The complete competition view should show:

```text
Rank | Start No | Driver | Horse(s) | Dressage | Marathon | Precision | Total | Status
```

Sorting:

1. eligible total results by total ranking rules
2. non-eligible competitors grouped below by status (`A`, `U`, `UG`, `S`)
3. competitors with no start or missing data at bottom.

### 12.3 Live partial result flags

Use clear labels for incomplete/live data:

| Flag | Meaning |
|---|---|
| `PROVISIONAL` | Result may still change. |
| `OFFICIAL` | Officially confirmed. |
| `UNDER_REVIEW` | Judge/jury review or protest pending. |
| `MISSING_TIME` | Waiting for time input. |
| `MISSING_PROTOCOL` | Waiting for judge protocol. |
| `ELIMINATION_PENDING_CONFIRMATION` | A possible elimination requires official confirmation. |

---

## 13. Rounding and precision

Recommended internal precision:

- Store raw times in hundredths of a second if electronic timing is used, otherwise tenths where manual timing is used.
- Store penalties internally as decimal with at least 4 decimal places.
- Display phase and total penalties with 2 decimals.

Do not round intermediate values before summing unless the official scoring software process explicitly requires it.

---

## 14. Validation checklist

Before publishing results, validate:

1. All required phase statuses exist.
2. Dressage max points and judge count are configured.
3. Marathon section distances and speeds are configured per technical profile.
4. Marathon min time, max time and time limit are calculated and displayed for officials.
5. Obstacle count and max gate letters match class table.
6. Precision course length, speed, allowed time and time limit are configured.
7. Carriage track width and cone width rules are configured.
8. Total result excludes any competitor with `A`, `U`, `UG` or `S` in any phase.
9. Placed count is calculated from starters and only completed competitors are marked placed.
10. For complete competitions with two-phase precision, only phase-1 precision penalties are used in the total.

---

## 15. Developer test cases

### 15.1 Dressage calculation

Input:

```yaml
max_points: 200
judge_totals: [150, 152]
c_judge_penalties: 5
```

Expected:

```pseudo
average_points = (150 + 152) / 2 = 151
base_penalties = 200 - 151 = 49
dressage_penalties = 49 + 5 = 54.00
```

### 15.2 Marathon B section time penalty

Input:

```yaml
b_max_time_seconds: 1800
b_min_time_seconds: 1680
actual_b_time_seconds: 1830
```

Expected:

```pseudo
late_seconds = 30
penalty = 30 * 0.25 = 7.50
```

### 15.3 Precision time penalty

Input:

```yaml
allowed_time_seconds: 150
actual_time_seconds: 156.40
```

Expected:

```pseudo
time_penalty = 6.40 * 0.5 = 3.20
```

### 15.4 Total tie-break

Competitor A:

```yaml
dressage: 55.00
marathon: 80.00
precision: 3.00
total: 138.00
```

Competitor B:

```yaml
dressage: 50.00
marathon: 85.00
precision: 3.00
total: 138.00
```

Expected: Competitor A ranks ahead because marathon penalties are lower.

### 15.5 Placed count

Input:

```yaml
starters: 17
```

Expected:

```pseudo
placed_count = ceil(17 / 4) = 5
```
