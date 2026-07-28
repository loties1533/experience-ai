# Architecture technique — Experience AI

> **Instantané de l'architecture actuelle.** L'arborescence de référence reste
> celle du [README principal](../../README.md) et le modèle métier celui du
> [doc 06](../06-modele-conceptuel.md).
>
> Les anciens diagrammes `trips`/`packs` et scoring de TripGenie ont été
> retirés : ils ne décrivent pas Experience AI.
>
> Les diagrammes sont écrits en **Mermaid**, directement dans ce fichier :
> GitHub les rend nativement, sans image à régénérer.

---

## Architecture globale

```mermaid
flowchart LR
    C["Client React"] --> API["API Express"]
    API --> G["Génération du parcours"]
    G --> D["Domaine<br/>Zod + invariants"]
    G --> S["Services métier"]
    API --> P["Dépôts Prisma"]
    P --> DB[("PostgreSQL")]

    G --> LLM["Fournisseurs LLM"]
    S --> FS["Foursquare<br/>identité des lieux"]
    S --> PHQ["PredictHQ<br/>identité des événements"]
    S --> METEO["Service météo"]
    S -. "pipeline prêt,<br/>activation F2-B5" .-> TAV["Tavily<br/>candidats de liens"]
```

Foursquare et PredictHQ alimentent déjà la génération outillée. Tavily est
utilisé par le résolveur sécurisé livré jusqu'à F2-B4, mais ce résolveur n'est
pas encore activé dans les parcours : cette jonction appartient à F2-B5.

---

## Pipeline de résolution des liens

```mermaid
flowchart LR
    I["Identité métier structurée<br/>Foursquare ou PredictHQ"] --> T["Tavily<br/>candidats Web"]
    T --> S["Sélection métier<br/>déterministe"]
    S -->|"aucun admissible"| N["Introuvable"]
    S -->|"plusieurs admissibles"| A["Ambigu<br/>aucun lien"]
    S -->|"candidat unique"| U["Validation pure de l'URL"]
    T -->|"panne technique"| X["Indisponible"]
    U --> DNS["Validation DNS<br/>et protection SSRF"]
    DNS --> UND["Transport Undici<br/>épinglé sur les IP validées"]
    UND --> R["Redirections manuelles<br/>maximum 3"]
    R --> OK["Accessible"]
    U --> REF["Refusé"]
    DNS --> REF
    R --> REF
    DNS --> X
    UND --> X
    R --> X
```

Tavily ne décide jamais seul et aucun LLM ne classe un lien comme réel. Le rang
de recherche ne départage pas plusieurs candidats. Une réservation ou une
billetterie exige des preuves explicites ; une page accessible ne devient pas
pour autant un site officiel. Faute de preuve externe forte, F2-B ne produit
actuellement aucun lien `officiel`. Une redirection vers un autre domaine
enregistrable invalide la preuve métier.

Le contrôle réseau commence seulement après la sélection d'un candidat unique.
Il distingue `accessible`, `refuse` et `indisponible` : une panne réseau n'est
jamais transformée en résultat `introuvable`.

`resoudreLiensReels` reste neutralisé jusqu'à F2-B5. L'appel depuis la
génération, la persistance, l'OpenAPI, les contrats de sortie et l'affichage
client sont donc hors périmètre actuel.

---

## Niveaux de confiance

```mermaid
flowchart TD
    D["Donnée proposée"] --> V{"Preuve métier suffisante ?"}
    V -->|"oui, provenance complète"| VER["Vérifié<br/>niveau persisté"]
    V -->|"valeur plausible non confirmée"| EST["Estimé<br/>niveau persisté"]
    V -->|"idée générique sans identité réelle"| SUG["Suggestion<br/>niveau persisté"]
    V -->|"donnée essentielle insuffisante"| REF["Refus métier<br/>résultat 422, non persisté"]
    D -->|"source essentielle indisponible"| TECH["Indisponibilité technique<br/>503"]
```

**Refus** est un résultat métier de génération, pas un quatrième niveau
persisté. Une URL techniquement accessible ne suffit jamais à produire
**Vérifié** ni à prouver qu'un domaine est officiel.

---

## Cascade LLM (repli automatique)

`callAI()` essaie les fournisseurs dans l'ordre pour les tâches sans outils ; le
premier qui répond gagne. Aucun contenu inventé en dernier recours : si tout
échoue, l'indisponibilité est **explicite** et refusée par la validation Zod en
aval.

```mermaid
flowchart LR
    Req["callAI()"] --> C{"Claude Haiku"}
    C -->|"OK"| Out["Réponse JSON"]
    C -->|"échec"| G{"Gemini 2.0 Flash"}
    G -->|"OK"| Out
    G -->|"échec"| O{"OpenRouter — modèles de secours"}
    O -->|"OK"| Out
    O -->|"échec"| M["Indisponibilité explicite<br/>(refusée par Zod en aval)"]
    M --> Out
```

> La génération de parcours utilise une variante **outillée**
> (`callAIAvecOutils`) pour chercher de vrais lieux et événements. Elle ne
> bascule pas silencieusement vers la cascade sans outils : si son fournisseur
> outillé est indisponible, elle renvoie une indisponibilité explicite.

---

## Authentification JWT

```mermaid
sequenceDiagram
    participant C as Client React
    participant A as routes/auth.ts
    participant P as Prisma
    participant DB as PostgreSQL

    C->>A: POST /api/auth/login {email, password}
    A->>P: prisma.user.findUnique({ where: { email } })
    P->>DB: SELECT * FROM users WHERE email = $1
    DB-->>P: user (id, hash)
    P-->>A: user
    A->>A: bcrypt.compare(password, hash)
    A->>A: jwt.sign({ userId }, secret, 7 jours)
    A-->>C: Set-Cookie httpOnly (secure, sameSite)
    Note over C,DB: Requêtes suivantes : cookie -> requireAuth -> filtrage where user_id
```

Le JWT transite dans un **cookie httpOnly** (jamais accessible au JS du navigateur). Chaque route protégée filtre sur l'utilisateur du token.

---

## Scalabilité horizontale

Les instances Express sont **stateless** (l'état est porté par le JWT), donc réplicables derrière un load balancer.

```mermaid
flowchart TB
    C["Clients"] --> LB["Load Balancer<br/>round-robin, least-connections, health checks"]
    LB --> A1["API 1 — Express (stateless)"]
    LB --> A2["API 2 — Express (stateless)"]
    LB --> A3["API 3 — Express (stateless)"]
    A1 --> DB[("PostgreSQL<br/>pool + réplicas lecture")]
    A2 --> DB
    A3 --> DB
```
