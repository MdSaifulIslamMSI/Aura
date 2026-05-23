# Login Database Index Plan & Optimization

This document outlines the indexing strategy for MongoDB to optimize authentication-related query patterns and prevent performance degradation under peak workloads.

---

## 1. Current Index Inventory (User Collection)

The `users` collection has the following critical indexes defined:

| Index Fields | Index Type | Unique | Purpose |
| :--- | :---: | :---: | :--- |
| `_id` | B-tree | Yes | Primary user identifier lookup. |
| `email` | B-tree | Yes | Unique lookup by email during registration, login, and cache invalidation. |
| `phone` | Partial B-tree | Yes | Unique lookup by phone numbers (ignoring empty fields via partialFilterExpression). |
| `authUid` | B-tree | Yes | Unique lookup by Firebase UID during auth sync. |

---

## 2. Proposed Index Optimizations

### 2.1 Multi-Field / Compound Indexes
During account discovery (`checkUserExists` in `otpController.js`), the server performs queries containing both identity fields and verification status:
* `User.findOne({ email, isVerified: true })`
* `User.findOne({ phone: canonicalPhone, isVerified: true })`

Without compound indexes, MongoDB performs a B-tree search on `email` or `phone` and then retrieves the document from disk to check the `isVerified` flag. Under high concurrency, this generates high disk I/O.

We propose adding the following compound indexes:

```javascript
// 1. Compound index for email lookups
db.users.createIndex(
  { email: 1, isVerified: 1 },
  { name: "email_1_isVerified_1" }
);

// 2. Compound index for phone lookups
db.users.createIndex(
  { phone: 1, isVerified: 1 },
  {
    name: "phone_1_isVerified_1",
    partialFilterExpression: {
      phone: { $exists: true, $type: "string", $gt: "" }
    }
  }
);
```

---

## 3. Explain Plan Comparison

Below is the expected MongoDB query execution plan transformation:

### 3.1 Plan Details

```
       [ Before Optimization ]                     [ After Optimization ]

       Query: { email: "...", isVerified: true }    Query: { email: "...", isVerified: true }

       ┌────────────────────────┐                  ┌────────────────────────┐
       │   IXSCAN (email)       │                  │ IXSCAN (email, verified)│
       └──────────┬─────────────┘                  └──────────┬─────────────┘
                  │                                           │ (Covered Query)
                  ▼                                           ▼
       ┌────────────────────────┐                  [ Return Index Entries ]
       │ FETCH Document (Disk)  │                   (No Disk FETCH required!)
       │ (Inspect isVerified)   │
       └────────────────────────┘
```

* **Covered Query**: The new compound indexes are "covered", meaning MongoDB can satisfy the query entirely from RAM index entries without executing a disk read (`FETCH`) for the document payload, reducing query execution time to $<1\text{ ms}$.
* **RAM Requirement**: The index sizes for compound B-trees are small ($\approx 12\text{-}15\text{ bytes}$ per document), representing negligible memory overhead that fits comfortably within the wiredTiger cache.
