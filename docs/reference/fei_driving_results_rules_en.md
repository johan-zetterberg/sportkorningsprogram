# FEI Driving Result Calculation Rules (2026) — Program Specification

> Purpose: this document defines a practical rule and data specification for software that calculates and displays live results for FEI Driving and Para Driving competitions under the FEI Driving and Para Driving Rules, 2026 edition.
>
> Scope: international FEI driving competitions, including CAI1*, CAI2*, CAI3*, CAIO4*, Championships, Para Driving, Youth classes and Young Horse/Pony competitions where relevant. The focus is result calculation, phase ranking, final classification, live scoring, status handling and penalties.
>
> Important: this is a software-oriented interpretation of the official FEI rules. The official FEI Driving Rules, FEI General Regulations, Veterinary Regulations, approved schedule, FEI Tack and Equipment requirements, and later FEI updates always take precedence.

---

## 1. Core concepts

### 1.1 Event, competition and phase terminology

FEI Driving uses the term **Event** for the whole show/class context and **CompetitionPhase** for the scored parts of the competition.

For standard Combined Driving Events, the main phases are:

| Phase code | FEI term | Purpose | Scoring basis |
|---|---|---|---|
| `DRESSAGE` | Driven Dressage | Quality, regularity, harmony, impulsion, accuracy, presentation | Penalties derived from dressage marks |
| `MARATHON` | Marathon | Fitness, stamina, training, driving skill | Time penalties, obstacle time penalties and other penalties |
| `CONES` | Cones | Fitness, obedience, suppleness, accuracy | Fault penalties plus time penalties |

For some lower-level formats, a `COMBINED_MARATHON` may be used instead of a full Marathon/Cones separation.

### 1.2 Fundamental ranking rule

For all standard penalty-based FEI Driving phases:

```pseudo
winner = athlete_with_lowest_penalties
```

Scores are calculated to **two decimal places**.

For a standard Event final classification:

```pseudo
final_penalties = dressage_penalties + marathon_penalties + cones_penalties
```

The Athlete with the lowest `final_penalties` wins the Event.

### 1.3 Equality of scores / tie-breaking

For a standard three-phase Event:

```pseudo
if final_penalties_equal:
    rank by lower marathon_penalties
if still_equal:
    rank by lower dressage_penalties
if still_equal:
    equal placing unless the event format defines another procedure
```

For Marathon phase equality, Athletes are placed equal unless the applicable FEI rule or schedule states otherwise.

For Cones, equality handling depends on the Cones competition type. A Drive-Off may be used if stated in the approved schedule.

---

## 2. Classes, categories and levels

### 2.1 FEI turnout classes

| Code | FEI class | Animal group | Horses/ponies in competition |
|---|---|---|---:|
| `H1` | Horse Single | Horse | 1 |
| `H2` | Horse Pair | Horse | 2 |
| `H4` | Horse Four-in-Hand | Horse | 4 |
| `P1` | Pony Single | Pony | 1 |
| `P2` | Pony Pair | Pony | 2 |
| `P4` | Pony Four-in-Hand | Pony | 4 |

A Horse or Pony may only take part once in each CompetitionPhase.

### 2.2 FEI event categories

| Category code | Description | Notes |
|---|---|---|
| `CAI1` | CAI1* | Lower level. May include Dressage, Cones and/or Combined Marathon depending on format. |
| `CAI2` | CAI2* | Lower level. May include standard Marathon or Combined Marathon depending on format. |
| `CAI3` | CAI3* | Higher level. Standard three-day format except specific formats. |
| `CAIO4` | CAIO4* | Team event, higher level. |
| `CHAMPIONSHIP` | FEI Championship | Standard Dressage, Marathon, Cones. |
| `CAIU25` | U25 | Youth category. |
| `CAIJ` | Junior | Youth category. |
| `CAICh` | Children | Youth category. |
| `CPEAI` | Para Driving | Para Driving category. |
| `CAIYH` / `CAIYP` | Young Horses / Young Ponies | Special scoring model. |

### 2.3 Competition formats by level

#### CAI1*

May be run over one or two days. Permitted formats include combinations of:

- Dressage
- Cones
- Dressage and Cones on the same day
- Combined Marathon

CAI1* is open to 1*, 2* and 3* Athletes.

#### CAI2*

May be run over two or three days. Formats may include:

- Dressage, Marathon, Cones
- Dressage, Cones, Marathon
- Dressage and Cones followed by Marathon
- Combined Marathon formats

CAI2* is open to 2* and 3* Athletes.

#### CAI3* and CAIO4*

Normally run over three days:

1. Dressage
2. Marathon
3. Cones

or

1. Dressage
2. Cones
3. Marathon

CAI3* and CAIO4* are open to 3* Athletes. Prize money is required.

#### Championships

Championship format:

1. Dressage
2. Marathon
3. Cones

Prize money is required except where FEI rules state otherwise, such as certain Youth and Young Horse/Pony Championships.

### 2.4 Star qualification model

| Athlete level | Minimum FEI qualification logic |
|---|---|
| `1_STAR` | No minimum qualification criteria. |
| `2_STAR` | Successfully completed two CAI1* at different shows in eligible formats without Elimination, Retirement or Disqualification; alternatives may exist under previous-rule or CAN provisions. |
| `3_STAR` | Successfully completed the required CAI2*/U25/J/Championship results without Elimination, Retirement or Disqualification; alternatives may exist under previous-rule provisions. |
| `YOUTH` | No minimum qualification criteria for Children, Junior and U25 unless Championship criteria apply. |
| `YOUNG_HORSE_PONY` | No minimum qualification criteria unless Championship criteria apply. |
| `PARA` | No minimum qualification criteria unless Championship criteria apply. |

For Championships, eligibility is governed by the FEI-published Championship criteria and must be checked separately.

---

## 3. Data model

### 3.1 Recommended identifiers

```text
event_id
competition_id
phase_id
class_code          // H1, H2, H4, P1, P2, P4
event_category      // CAI1, CAI2, CAI3, CAIO4, CHAMPIONSHIP, CPEAI, etc.
athlete_id          // FEI ID
turnout_id          // event-specific athlete/horse/carriage combination
horse_ids[]         // FEI IDs plus A-F horse letters
```

### 3.2 Recommended turnout object

```json
{
  "turnoutId": "2026-FEI-001-H1-023",
  "eventNumber": 23,
  "athlete": { "feiId": "...", "name": "...", "nationalFederation": "..." },
  "classCode": "H1",
  "eventCategory": "CAI3",
  "horses": [
    { "feiId": "...", "letter": "A", "name": "..." }
  ],
  "grooms": [
    { "name": "...", "participatingSupportPersonnel": true }
  ],
  "status": "ACTIVE"
}
```

### 3.3 Phase result object

```json
{
  "phase": "MARATHON",
  "status": "OK",
  "penalties": 88.42,
  "rank": 4,
  "breakdown": {
    "sectionTimePenalties": 2.75,
    "obstacleTimePenalties": 74.67,
    "drivingPenalties": 11.00
  }
}
```

---

## 4. Status codes and continuation rules

### 4.1 Status codes

| Code | FEI term | Meaning | Final classification effect | May compete in later phase? |
|---|---|---|---|---|
| `OK` | Completed | Valid numeric score | Eligible if all required phases are OK | Yes |
| `E` | Eliminated | Eliminated from a CompetitionPhase | Not eligible for phase placing or final classification | Usually yes, unless welfare/specific rule prevents it |
| `D` | Disqualified | Disqualified from the Event or phase | Not eligible for any further part or prize | No |
| `R` | Retired | Athlete decides not to continue in a phase | Not eligible for phase placing or final classification | May compete in later phases |
| `W` | Withdrawn | Fails to start a phase | Not eligible for final classification | No further participation with that turnout |

### 4.2 Final classification eligibility

```pseudo
eligible_for_final = all(required_phase.status == OK for required_phase in event.required_phases)
```

If any required phase is `E`, `D`, `R` or `W`, the turnout is not included in final classification. The result sheet should list the turnout with the relevant status.

### 4.3 Phase placing eligibility

```pseudo
eligible_for_phase_placing = phase.status == OK
```

Athletes who Retire or are Eliminated from a phase may not be placed in that phase. Disqualified Athletes may not receive prizes.

### 4.4 Welfare elimination

The Ground Jury may eliminate a turnout at any time if continuing would be contrary to horse welfare. This decision is final and not subject to protest/appeal in the competition context.

---

## 5. Driven Dressage calculation

### 5.1 Input data

For each judge:

```json
{
  "judgePosition": "C",
  "movementMarks": [7.0, 6.5, 7.5],
  "generalImpressionMarks": [7.0, 7.5]
}
```

Also store:

```json
{
  "testMaxRawMarks": 200,
  "coefficient": 0.8,
  "presidentPenalties": 5.0
}
```

The coefficient is printed on the official score sheet where the total possible marks are greater than 160.

### 5.2 Mark scale

| Mark | Meaning |
|---:|---|
| 10 | Excellent |
| 9 | Very good |
| 8 | Good |
| 7 | Fairly good |
| 6 | Satisfactory |
| 5 | Sufficient |
| 4 | Insufficient |
| 3 | Fairly bad |
| 2 | Bad |
| 1 | Very bad |
| 0 | Not executed |

Half marks are allowed.

### 5.3 Dressage formula

```pseudo
judge_total[j] = sum(movement_marks[j]) + sum(general_impression_marks[j])
average_raw_score = sum(judge_total) / number_of_judges

if test_max_raw_marks > 160:
    adjusted_average_score = average_raw_score * coefficient
else:
    adjusted_average_score = average_raw_score

final_score_points = adjusted_average_score - president_penalties
dressage_penalties = 160 - final_score_points

dressage_penalties = round_to_2_decimals(dressage_penalties)
```

The Athlete with the lowest `dressage_penalties` wins Driven Dressage.

### 5.4 Dressage penalties and status effects

| Incident | Penalty/status |
|---|---:|
| Part of turnout leaves arena during a movement | Mark down for inaccuracy |
| Whole turnout leaves arena | Elimination |
| Athlete dismounts | 20 penalties |
| Starts without whip | 5 penalties |
| Drops or puts down whip | 5 penalties |
| Groom handles reins, brake or whip | 20 penalties |
| Groom speaks or indicates course | 10 penalties once per test |
| Groom dismounts, first incident | 5 penalties |
| Groom dismounts, second incident | 10 penalties |
| Groom dismounts, third incident | Elimination |
| Error of course, first | 5 penalties |
| Error of course, second | 10 penalties |
| Error of course, third | Elimination |
| Disobedience, first | 5 penalties |
| Disobedience, second | 10 penalties |
| Disobedience, third | Elimination |
| Carriage overturn | Elimination |
| Lame horse in Dressage | Horse disqualified, Athlete eliminated |
| Physical outside assistance | Elimination |
| Bandages or brushing boots in Dressage | 10 penalties and horse inspection |

### 5.5 Live dressage scoring rule

If live scoring is used, publish only the evolving **percentage** during the test, not individual judge marks.

Recommended live display fields:

```json
{
  "phase": "DRESSAGE",
  "livePercentage": 68.42,
  "provisionalPenalties": 50.53,
  "status": "PROVISIONAL"
}
```

---

## 6. Marathon calculation

### 6.1 Marathon structure

A Marathon phase consists of:

- Section A or Controlled Warm-Up where applicable
- Section B
- Obstacles in the Marathon
- Cool Down area / post-Marathon examination where applicable

The Marathon score is a sum of:

```pseudo
marathon_penalties = section_time_penalties
                   + obstacle_time_penalties
                   + driving_penalties
                   + equipment_or_welfare_penalties
```

Scores are calculated to two decimals.

### 6.2 Section B distance, speed and obstacle count

| Level / class group | Section B distance | Horse speed | Pony speed | Obstacles |
|---|---:|---:|---:|---:|
| Championships | 7–9 km | 12–14 km/h | 11–13 km/h | 8 |
| Championships singles | 7–9 km | 12–14 km/h | 11–13 km/h | 7–8 |
| 3* / 4* | 5–9 km | 12–14 km/h | 11–13 km/h | 6–8 |
| 2* | 5–9 km | 12–14 km/h | 11–13 km/h | 5–7 |
| Junior + U25 | 4–8 km | 12–14 km/h | 11–13 km/h | 5–6 |
| Children | 4–8 km | 11–13 km/h | See schedule/class | 4–5 |
| Para | 4–8 km | 12–14 km/h | 11–13 km/h | 5–6 |

The approved schedule and Technical Delegate/Ground Jury decisions may reduce speeds for adverse weather or ground conditions.

### 6.3 Time allowed and minimum time

```pseudo
time_allowed_seconds = section_distance_meters / speed_meters_per_second
minimum_time_section_B = time_allowed_seconds - 180
minimum_time_section_A_or_controlled_warmup = time_allowed_seconds - 120
section_B_time_limit = 2 * time_allowed_seconds
section_A_time_limit = time_allowed_seconds * 1.20
```

### 6.4 Section time penalties

For each applicable section:

```pseudo
if actual_time > time_allowed:
    penalty = (actual_time - time_allowed) * 0.25
elif actual_time < minimum_time:
    penalty = (minimum_time - actual_time) * 0.25
else:
    penalty = 0
```

Late start:

```pseudo
late_start_penalty = seconds_late * 0.25
```

Exceeding the section time limit results in Elimination.

### 6.5 Obstacle time penalties

The time in all Marathon obstacles is added and converted:

```pseudo
obstacle_time_penalties = total_obstacle_time_seconds * 0.25
```

Obstacle times are recorded to hundredths of a second. No rounding is applied before conversion; final phase penalties are rounded to two decimals.

### 6.6 Obstacle completion and gate logic

A compulsory gate becomes free only after it has been driven in the correct direction and correct sequence.

```pseudo
for gate in required_gates_order:
    if driven_gate == expected_gate and correct_direction:
        mark_gate_free(gate)
    else:
        error_of_course = true
```

If an error is corrected before exiting the obstacle:

```pseudo
add 20 penalties per corrected error
```

If the Athlete exits without correcting the error, or passes the exit before all compulsory gates have been driven correctly:

```pseudo
status = E
```

The whole turnout must pass between the flags for a gate to count.

### 6.7 Marathon penalties

| Incident | Penalty/status |
|---|---:|
| Athlete or Groom wearing shorts | 10 penalties per person |
| No required protective headgear/body protector | Elimination or Yellow Warning Card depending on location/context |
| Finishing Section B with fewer horses than required | Elimination |
| Horse not presented at required In-Harness Horse Inspection | Elimination |
| Carriage underweight or under required width | Elimination |
| No breeching where required | Elimination |
| Groom substitutes during Marathon | Elimination |
| Groom handles reins/whip/brake while carriage not stationary | 20 penalties |
| Person tied to carriage | Elimination |
| Outside physical assistance | Elimination |
| Groom leads Horse through obstacle | 25 penalties total |
| Incorrect pace in final restricted area | 1 penalty per 5 seconds |
| Crossing a marked double line | 20 penalties |
| Dislodging a dislodgeable element | 2 penalties each |
| Preventing a dislodgeable element from falling | 10 penalties |
| Over time allowed in sections | 0.25 per second |
| Under minimum time in sections | 0.25 per second |
| Obstacle time | 0.25 per second |
| Failure to stop when recalled | Elimination |
| Whip used by Groom | 20 penalties |
| Deviation from course after last obstacle | 10 penalties each |
| Required persons not on carriage through CTF/start/finish | 5 penalties for Groom, 20 for Athlete as applicable |
| Groom dismounts while moving outside obstacles | 5 penalties |
| Athlete dismounts while moving outside obstacles | 20 penalties |
| Missing/disconnected pole strap, trace or reins at finish | 10 penalties each |
| Missing wheel at Section B finish | Elimination |
| Broken/disconnected pole or shaft at finish | Elimination |
| Failing to pass CTFs/obstacles in correct sequence/direction | Elimination |
| Groom not on carriage at obstacle start | 5 penalties |
| Groom not remounting immediately after obstacle | 5 penalties |
| Exceeding 5 minutes in an obstacle | Elimination |
| Corrected error of course in obstacle | 20 penalties |
| Groom dismounts in obstacle | 5 penalties each occasion |
| Athlete dismounts in obstacle | 20 penalties |
| Two feet on an obstacle element | 5 penalties |
| Groom climbs over horse back or down pole | 20 penalties |
| Disconnecting and leading through obstacle | Elimination |
| Failure to stop for leg over pole/lead bar/shaft | Elimination |
| Failure to stop for leg over trace | 30 penalties |
| Carriage overturn | Elimination |

### 6.8 Marathon classification

```pseudo
marathon_penalties = round_to_2_decimals(
    section_time_penalties
  + obstacle_time_penalties
  + driving_penalties
)
```

The Athlete with the lowest Marathon penalties wins Marathon. In case of equality in Marathon phase penalties, Athletes are placed equal unless the schedule/rules specify otherwise.

---

## 7. Cones calculation

### 7.1 Standard Cones competition types

| Code | FEI competition type | Used for |
|---|---|---|
| `FAULT` | Fault Competition | Standard Combined Driving Events; penalties plus time over allowed |
| `TIME` | Time Competition | Cones placings only; faults converted to seconds |
| `TWO_PHASES` | Competition in two phases/rounds | May be used in Cones phase; first part may count for combined result |
| `WINNING_ROUND` | Competition with Winning Round | First round may count for final classification; winning round determines Cones placings |
| `DRIVE_OFF` | Drive-Off | Tie-break for Cones if in schedule |

### 7.2 Course requirements

| Field | Standard rule |
|---|---|
| Course length | 500–800 m; Children may be shorter |
| Obstacles | Maximum 20; Children maximum 15 |
| Start/finish to first/last obstacle | 20–40 m |
| Arena | Normally at least 5000 m² with minimum width 40 m, or equivalent |
| Warm-up | At least 3200 m² |
| Time limit | Twice the time allowed |

### 7.3 Cones speeds and widths

| Division | Class | Speed | Base cones width | Serpentine | Zig-zag | Wave | Min distance between obstacles |
|---|---|---:|---:|---:|---:|---:|---:|
| Horse | Four-in-Hand | 240 m/min | 185 cm | 10–12 m | 11–13 m | 10–12 m | 15 m |
| Horse | Pair | 250 m/min | 170 cm | 6–8 m | 10–12 m | 8–10 m | 12 m |
| Horse | Single | 250 m/min | 160 cm | 6–8 m | 10–12 m | 8–10 m | 12 m |
| Horse/Pony | Para Driving | 230 m/min | See class/schedule | See annex | See annex | See annex | See course |
| Pony | Four-in-Hand | 240 m/min | 160 cm | 8–10 m | 9–11 m | 8–10 m | 12 m |
| Pony | Pair | 250 m/min | 160 cm; Children 20 cm clearance | 8–10 m | 9–11 m | 8–10 m | 12 m |
| Pony | Single | 260 m/min | 160 cm | 6–8 m | 9–11 m | 8–10 m | 12 m |
| Pony | Children | 220 m/min | See schedule/class | See annex | See annex | See annex | See course |

Up to five single obstacles may be reduced by 5 cm for Pairs and Four-in-Hand. Up to ten single obstacles may be reduced by 5 cm for Singles.

### 7.4 Time allowed and time penalties

```pseudo
time_allowed_seconds = course_length_meters / speed_meters_per_second
time_limit_seconds = 2 * time_allowed_seconds
```

For Fault Competition:

```pseudo
time_penalties = max(0, actual_time - time_allowed) * 0.5
```

For Time Competition:

```pseudo
total_time = driven_time_seconds + converted_penalty_seconds
```

### 7.5 Fault Competition formula

```pseudo
cones_penalties = obstacle_fault_penalties
                + disobedience_penalties
                + dismount_penalties
                + dress_equipment_penalties
                + time_penalties
```

### 7.6 Time Competition formula

```pseudo
cones_total_time = driven_time_seconds
                 + converted_fault_seconds
                 + converted_disobedience_seconds
                 + converted_dismount_seconds
                 + time_over_allowed_seconds * 0.5
```

Classification is by lowest `cones_total_time`.

### 7.7 Common Cones penalties

| Incident | Fault Competition | Time Competition |
|---|---:|---:|
| Athlete or Groom starts without required protective headgear | Elimination | Elimination |
| Athlete improper dress/headgear/gloves/apron | 5 penalties | 5 seconds |
| Groom improper dress/headgear/gloves | 5 penalties | 5 seconds |
| Groom not in position, first breach | 5 penalties | 5 seconds |
| Groom not in position, second breach | 10 penalties | 10 seconds |
| Groom not in position, third breach | Elimination | Elimination |
| Driving without whip | 5 penalties | 5 seconds |
| Dropping/putting down whip | 5 penalties | 5 seconds |
| Groom handles reins/brake/whip before finish | 20 penalties | 20 seconds |
| Person tied to carriage | Elimination | Elimination |
| Prohibited outside assistance | Elimination | Elimination |
| Failing to start within 45 seconds | Timing starts | Timing starts |
| Passing an obstacle before bell | 10 penalties and restart | 10 seconds and restart |
| Failing to pass start or finish | Elimination | Elimination |
| One or two balls down in same single obstacle | 3 penalties | 3 seconds |
| Element down in multiple obstacle | 3 penalties | 3 seconds |
| Obstacle already driven is knocked down | 3 penalties | 3 seconds |
| Obstacle in advance is knocked down | 3 penalties + 10 seconds | 3 seconds + 10 seconds |
| Wrong obstacle sequence or direction | Elimination | Elimination |
| Failure to halt after second bell | Elimination | Elimination |
| Obstacle rebuild caused by Athlete | 3 penalties + 10 seconds | 3 seconds + 10 seconds |
| Starts before bell after rebuild | Elimination | Elimination |
| Athlete dismounts | 20 penalties | 20 seconds |
| Groom dismounts first incident | 5 penalties | 5 seconds |
| Groom dismounts second incident | 10 penalties | 10 seconds |
| Groom dismounts third incident | Elimination | Elimination |
| Groom leads Horse through obstacle | 25 penalties | 25 seconds |
| Disobedience first incident | 5 penalties | 5 seconds equivalent where applicable |
| Disobedience second incident | 10 penalties | 10 seconds equivalent where applicable |
| Disobedience third incident | Elimination | Elimination |
| Time over allowed | seconds over × 0.5 | seconds over × 0.5 |
| Exceeding time limit | Elimination | Elimination |
| Groom standing between start and finish | 5 penalties | 5 seconds |
| Carriage overturn | Elimination | Elimination |

### 7.8 Cones error of course logic

```pseudo
if athlete_passes_obstacle_wrong_sequence_or_direction:
    wait_until_whole_turnout_passes_wrong_obstacle
    ring_bell
    status = E
```

If doubt exists whether an obstacle was driven correctly, the Athlete is allowed to finish and the Jury decides afterward.

### 7.9 Cones classification

Fault Competition:

```pseudo
rank by lowest cones_penalties
if equal:
    rank by fastest driven time unless Drive-Off scheduled
```

Drive-Off:

```pseudo
if equality_for_first and schedule_allows_drive_off:
    run drive_off
    classify drive_off by time competition rules
else:
    use first round penalties and time; if still equal, equal placing
```

---

## 8. Combined Marathon

### 8.1 CAI1* Combined Marathon

| Field | Rule |
|---|---|
| Marathon-type obstacles | Maximum 2 |
| Cone-type obstacles | 8–12 |
| Distance | 600–800 m |
| Speed | 230 m/min |
| Classification | Fault Competition with time allowed; penalties and driven time |

### 8.2 CAI2* Combined Marathon

| Field | Rule |
|---|---|
| Marathon-type obstacles | Maximum 2 |
| Cone-type obstacles | 8–12 |
| Distance | 600–800 m |
| Speed | 240 m/min |
| Classification | Time Competition |

### 8.3 Combined Marathon penalty model

Use Cones-style penalties for cone obstacles and Marathon-style wrong-course logic for Marathon-type obstacles.

Key penalties:

| Incident | Penalty/status |
|---|---:|
| Ball(s) down in single cones obstacle | 3 penalties |
| Marathon obstacle element knocked over/down | 3 penalties |
| Obstacle in advance knocked down | 3 penalties + 10 seconds |
| Corrected wrong course in Marathon-type obstacle | 20 penalties |
| Uncorrected wrong course | Elimination |
| Groom handles reins/whip/brake while carriage not stationary | 20 penalties |
| Groom dismounts first/second | 5 penalties per incident |
| Athlete dismounts | 20 penalties |
| Third dismount by Athlete/Groom | Elimination |
| Third disobedience | Elimination |
| Broken/disconnected reins/pole straps/traces or leg over shaft/trace/pole/bar | Bell, clock stopped, Groom down; 5 penalties for Groom down |
| Failure to stop after repeated bell | Elimination |
| No required protective headgear/body protector | Elimination |
| Failure to pass start/finish | Elimination |
| Carriage overturn | Elimination |
| Outside physical assistance | Elimination |
| Exceeding time allowed | seconds over × 0.5 |
| Exceeding time limit | Elimination |

---

## 9. Team classification

### 9.1 Championships and CAIOs

For standard horse team competitions:

```pseudo
for each phase:
    select two team members with lowest penalties in that phase
    team_phase_score = sum(selected_two_phase_scores)
team_final_score = sum(team_phase_score for all phases)
```

Only team members who completed all three phases can count toward final team scores.

### 9.2 Pony Championships

The team classification is determined by adding the best score from:

- Single Pony
- Pair Pony
- Four-in-Hand Pony

Only team members who complete all three phases without Elimination can count.

### 9.3 Youth Championships

The team classification is determined by adding the best score from each age category:

- Children
- Junior
- U25

Only team members who complete all three phases without Elimination can count.

### 9.4 Para Driving Championships

A Para Driving team consists of three Athletes. Each team must include at least one Grade I Athlete. Team composition and classification must also follow the specific Championship schedule and Para Driving provisions.

---

## 10. Para Driving rules for scoring systems

### 10.1 Para grades

| Grade | Meaning |
|---|---|
| `GRADE_I` | Lower functional ability group |
| `GRADE_II` | Higher functional ability group |

Grade I and Grade II Athletes are separate classes. An Athlete may enter a higher grade than classified, but not a lower grade.

### 10.2 Para class support

Para Driving Athletes may use compensating aids recorded on the FEI Classification Master List. Software should store:

```json
{
  "paraGrade": "GRADE_I",
  "classificationProfile": "...",
  "approvedCompensatingAids": ["whip_held_by_groom", "brake_operated_by_groom"],
  "masterListVerified": true
}
```

### 10.3 Para rule exceptions relevant to scoring

Depending on the FEI Classification Master List, Para Driving Athletes may be allowed:

- no gloves or adapted gloves;
- Groom to hold/use the whip;
- Groom to operate the brake;
- Groom to hold the finger loop;
- one-handed movements with two hands;
- wheelchair or support belt with quick-release system;
- motor vehicle to inspect the Marathon course where approved.

Do not apply a penalty for an action that is explicitly approved as a compensating aid for that Athlete.

```pseudo
if action in athlete.approvedCompensatingAids:
    penalty = 0
else:
    apply_standard_penalty(action)
```

---

## 11. Young Horse / Young Pony competitions

Young Horse/Pony competitions have a special scoring model and should not be treated as ordinary penalty-only Combined Driving unless the schedule explicitly says so.

### 11.1 Levels

| Horses | Ponies |
|---|---|
| `CAI_YH1_5YO` | `CAI_YP1_5YO` |
| `CAI_YH1_6YO` | `CAI_YP1_6YO` |
| `CAI_YH1_7YO` | `CAI_YP1_7YO` |
| `CH_M_YH_5YO` | `CH_M_YP_5YO` |
| `CH_M_YH_6YO` | `CH_M_YP_6YO` |
| `CH_M_YH_7YO` | `CH_M_YP_7YO` |

Horses and ponies compete in separate classes.

### 11.2 Young Horse/Pony Championship scoring

| Age | Day 1 | Day 2 | Day 3 | Final scoring |
|---|---|---|---|---|
| 5-year-old | YH3 with Cones, single final mark | Combined Marathon: 7–10 cones and 2 Marathon obstacles A–D | YH3 with Cones, single final mark | Day 2 score + Day 3 score |
| 6-year-old | YH4 with Cones, single final mark | Combined Marathon: 2 Marathon obstacles A–E and 10–13 cones | YH4 with Cones, single final mark | Day 2 score + Day 3 score |
| 7-year-old | YH4 with Cones, single final mark | Combined Marathon: 2 Marathon obstacles A–F and 10–13 cones | YH4 with Cones, single final mark | Day 2 score + Day 3 score |

Incidents use reduced deductions compared with normal Driving rules, typically 1/10 of the normal FEI penalty points. Example: a ball down is 0.3 and a Groom down is 0.5. Time over allowed in Cones Driving is 0.1 per second.

### 11.3 Young Horse/Pony tie-break

For equality of scores in the top three after Day 3:

```pseudo
tie_break_average = (self_motivation_agility_productive_efficiency
                   + perspective_potential) / 2
rank higher tie_break_average first
if still tied:
    rank by higher Day 3 score
```

---

## 12. Entries, substitutions and horse declarations

### 12.1 Declared horses

| Class | Definite-entry horse count | Start count per phase |
|---|---:|---:|
| Four-in-Hand | 5 | Any 4 of the declared 5 |
| Pair | 3 | Any 2 of the declared 3 |
| Single | 1 | The single declared horse |

### 12.2 Substitution rules during an Event

```pseudo
if class == FOUR_IN_HAND:
    phase_horses must be subset of declared_horses size 4
elif class == PAIR:
    phase_horses must be subset of declared_horses size 2
elif class == SINGLE:
    phase_horses must equal declared_single_horse
```

A Horse may be used by another Athlete in the same class after the first Horse Inspection only under the specific FEI conditions and must then stay with the new Athlete for the whole Event.

---

## 13. Starting order logic

### 13.1 CAI first phase

The first phase starting order is drawn physically in the presence of the President of the Ground Jury and is open to Athletes.

### 13.2 CAI later phases

For second and third phases:

```pseudo
start_order = [
    athletes_competing_twice_highest_placing_first,
    retired_athletes,
    eliminated_athletes,
    remaining_athletes_sorted_by_descending_penalties
]
```

The Athlete with the lowest penalties starts last among eligible remaining Athletes.

### 13.3 CAIOs and Championships — Cones

Cones starts in reverse order of Dressage + Marathon penalties:

```pseudo
cones_start_order = retired_first
                  + eliminated_next
                  + active_sorted_by_descending(dressage_penalties + marathon_penalties)
```

If Dressage + Marathon penalties are equal, Marathon result decides the order.

---

## 14. Placings and prize handling

### 14.1 Phase placings

For each phase:

```pseudo
phase_placing_list = all turnouts where phase.status == OK
sort by phase-specific ranking rule
```

Do not place turnouts with `E`, `D`, `R` or `W` for that phase.

### 14.2 Final placings

```pseudo
final_placing_list = all turnouts where final_eligible == true
sort by final_penalties, then marathon_penalties, then dressage_penalties
```

### 14.3 Prize money eligibility

```pseudo
if athlete.status includes D:
    prize_money = 0
elif phase.status in [E, R]:
    no placing and no prize for that phase
elif phase.status == OK:
    eligible_for_phase_prize = true
```

The number of prizes and distribution should be read from the FEI approved schedule and FEI General Regulations, not hardcoded in this rules engine.

---

## 15. Validation rules for software

### 15.1 Pre-start validation

Validate before each phase:

```pseudo
validate_class_horse_count()
validate_declared_horses_for_phase()
validate_groom_age_and_presence()
validate_required_safety_equipment()
validate_carriage_width_weight_if_phase_requires()
validate_para_compensating_aids()
validate_horse_inspection_status()
```

### 15.2 Result publication states

Recommended result states:

| State | Meaning |
|---|---|
| `LIVE` | Being updated during phase |
| `PROVISIONAL` | Phase completed but not signed/published as official |
| `OFFICIAL` | Signed by Ground Jury and published |
| `CORRECTED` | Official result later corrected under FEI process |

Official results are those signed by the Ground Jury and published on the official board/show office channel.

### 15.3 Numeric precision

Use decimal arithmetic, not binary floating point.

```pseudo
Decimal seconds_to_penalties(Decimal seconds, Decimal multiplier):
    return round(seconds * multiplier, 2)
```

Store raw times to hundredths of a second where provided, then calculate and round the displayed penalty total to two decimals.

---

## 16. Example calculations

### 16.1 Dressage example

```text
Judge totals: 145.5, 148.0, 142.5
Average raw score = (145.5 + 148.0 + 142.5) / 3 = 145.3333
Coefficient = 1.0
President penalties = 5.0
Final score points = 145.3333 - 5.0 = 140.3333
Dressage penalties = 160 - 140.3333 = 19.6667 => 19.67
```

### 16.2 Marathon example

```text
Section B time allowed = 3000.00 sec
Minimum time = 2820.00 sec
Actual time = 3024.00 sec
Section time penalty = 24.00 * 0.25 = 6.00

Total obstacle time = 210.46 sec
Obstacle time penalty = 210.46 * 0.25 = 52.615 => 52.62

Driving penalties = 7.00
Marathon penalties = 6.00 + 52.62 + 7.00 = 65.62
```

### 16.3 Cones Fault Competition example

```text
Time allowed = 180.00 sec
Actual time = 183.26 sec
Balls down = 2 single obstacles = 6 penalties
Time penalty = 3.26 * 0.5 = 1.63
Cones penalties = 6 + 1.63 = 7.63
```

### 16.4 Final result example

```text
Dressage = 52.14
Marathon = 65.62
Cones = 7.63
Final = 125.39
```

Tie-break:

```pseudo
if two athletes both have 125.39:
    lower Marathon wins
if Marathon equal:
    lower Dressage wins
```

---

## 17. Suggested API outputs

### 17.1 Phase result

```json
{
  "competitionId": "CAI3-H1-2026-001",
  "phase": "CONES",
  "status": "OFFICIAL",
  "results": [
    {
      "rank": 1,
      "turnoutId": "23",
      "athleteName": "Example Athlete",
      "penalties": "3.25",
      "status": "OK",
      "breakdown": {
        "obstaclePenalties": "3.00",
        "timePenalties": "0.25",
        "otherPenalties": "0.00"
      }
    }
  ]
}
```

### 17.2 Final classification

```json
{
  "competitionId": "CAI3-H1-2026-001",
  "status": "OFFICIAL",
  "classification": [
    {
      "rank": 1,
      "turnoutId": "23",
      "dressage": "52.14",
      "marathon": "65.62",
      "cones": "7.63",
      "total": "125.39",
      "status": "OK"
    },
    {
      "rank": null,
      "turnoutId": "31",
      "dressage": "58.01",
      "marathon": null,
      "cones": "12.00",
      "total": null,
      "status": "E_IN_MARATHON"
    }
  ]
}
```

---

## 18. Implementation checklist

1. Build classes for `Event`, `Competition`, `Phase`, `Turnout`, `Horse`, `Athlete`, `Groom` and `PenaltyEvent`.
2. Store all raw marks, raw times and incident records.
3. Calculate Dressage from judge marks and President-at-C penalties.
4. Calculate Marathon from section times, obstacle times and incident penalties.
5. Calculate Cones according to competition type: Fault, Time, Two Phases, Winning Round or Drive-Off.
6. Apply status rules before ranking.
7. Apply final tie-break: total, Marathon, Dressage.
8. For team competitions, calculate phase team scores from eligible completed Athletes only.
9. For Para Driving, check approved compensating aids before adding penalties.
10. For Young Horse/Pony competitions, use the special mark-based model instead of ordinary final penalty aggregation.
11. Publish live/provisional/official states separately.
12. Keep the approved schedule as a first-class data source for format, prizes, tests, speeds, course length and special provisions.

---

## 19. Rule-source map for developers

| Software topic | FEI rule area |
|---|---|
| Event/class structure | Articles 901–903 |
| Equality of scores | Article 904 |
| Team classification | Articles 905–907 |
| Status codes | Article 911 |
| Age and qualification | Articles 912–914 |
| Entries and substitutions | Articles 916, 946 |
| Dress/safety/whips | Article 928 |
| Horses and inspections | Articles 929–935 |
| Carriages/harness | Articles 936–942 |
| Participation and outside assistance | Articles 943–945 |
| Starting order | Articles 947–948 |
| Driven Dressage | Articles 949–958 |
| Marathon | Articles 959–969 |
| Cones | Articles 970–981 |
| Para Driving | Annex 8 |
| Young Horses/Ponies | Annex 13 |
