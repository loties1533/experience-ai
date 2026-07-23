# 08 — Architecture IA

> Principe ([ADR-0003](decisions/ADR-0003.md)) : les agents sont des **modules** (`server/agents/`), pas des microservices. **Peu d'agents, chacun justifié par une capacité.** Détaillé à l'étape build (sprint R4).

## Deux IA distinctes — à ne jamais confondre

| | **L'orchestrateur** (`agents/generation.ts`) | **L'agent Modification** (`agents/modification.ts`) |
|---|---|---|
| Rôle | Brief confirmé → **parcours complet**, en une passe | Phrase → **une demande ciblée** dans un parcours existant |
| Périmètre | Tout le parcours, une seule fois | Un élément et ses dépendances, jamais l'ensemble |
| Vocabulaire de sortie | Moments + éléments (refs) | `DemandeModificationSchema` — rien d'autre : il **ne peut pas** régénérer tout |
| Qui applique | Le domaine valide (`validerParcours`) avant de sortir | Le domaine applique **ou refuse** (`appliquerModification`) |

S'y ajoute l'**intake** (`agents/intake.ts`) : le dialogue de cadrage (doc 05, étapes 1→4). Il extrait le brief, ne pose que les questions nécessaires, et reformule pour validation. Il ne génère rien.

## Les règles de méfiance (communes aux trois)

1. **Ne jamais faire confiance à la sortie du LLM** : tout passe par un schéma Zod ; ce qui ne valide pas est ignoré (intake) ou rejeté avec une erreur actionnable (génération, modification).
2. **Les ids naissent côté serveur** : le LLM manipule des refs jetables ; les dépendances vers des refs inventées sont écartées.
3. **Le domaine est la seule autorité** : aucune IA n'écrit l'état ; elles produisent des propositions que `server/domaine/parcours/` valide, applique ou refuse.
4. **Cascade de repli** héritée de TripGenie (`services/claude/core.ts`) : Claude → Gemini → OpenRouter → secours.

## Agents futurs (au besoin, jamais par anticipation)
Recherche (données réelles), Mémoire (préférences contextuelles, V3), Groupe (V3). Chacun devra se justifier par une capacité du [doc 07](07-capacites-produit.md).
