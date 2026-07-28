# 08 — Architecture IA

> Principe ([ADR-0003](decisions/ADR-0003.md)) : les agents sont des
> **modules**, pas des microservices. Peu d'agents, chacun justifié par une
> tâche de raisonnement. L'état actuel est fonctionnel mais doit évoluer selon
> le [plan de fiabilité](14-fiabilite-parcours.md).

## Deux IA distinctes — à ne jamais confondre

| | **L'orchestrateur** (`agents/generation.ts`) | **L'agent Modification** (`agents/modification.ts`) |
|---|---|---|
| Rôle | Brief confirmé → **parcours complet**, actuellement en une passe | Phrase → **une demande ciblée** dans un parcours existant |
| Périmètre | Tout le parcours, une seule fois | Un élément et ses dépendances, jamais l'ensemble |
| Vocabulaire de sortie | Moments + éléments (refs) | `DemandeModificationSchema` — rien d'autre : il **ne peut pas** régénérer tout |
| Qui applique | Le domaine valide (`validerParcours`) avant de sortir | Le domaine applique **ou refuse** (`appliquerModification`) |

S'y ajoute l'**intake** (`agents/intake.ts`) : le dialogue de cadrage (doc 05, étapes 1→4). Il extrait le brief, ne pose que les questions nécessaires, et reformule pour validation. Il ne génère rien.

## Les règles de méfiance (communes aux trois)

1. **Ne jamais faire confiance à la sortie du LLM** : tout passe par un schéma Zod ; ce qui ne valide pas est ignoré (intake) ou rejeté avec une erreur actionnable (génération, modification).
2. **Les ids naissent côté serveur** : le LLM manipule des refs jetables ; les dépendances vers des refs inventées sont écartées.
3. **Le domaine est la seule autorité** : aucune IA n'écrit l'état ; elles produisent des propositions que `server/domaine/parcours/` valide, applique ou refuse.
4. **Cascade de fournisseurs LLM** (`services/claude/core.ts`) : Claude →
   Gemini → OpenRouter. Elle assure la disponibilité du raisonnement, mais ne
   doit pas autoriser une baisse silencieuse de la qualité des données.

## Contrat de repli F1 en cours de validation

La génération outillée ne retombe plus sur un modèle sans outils après l'échec
de sa boucle. Elle renvoie une indisponibilité explicite. Une recherche bien
exécutée mais sans résultat peut produire une suggestion générique, sans nom
propre ni faux lien. Chaque élément final porte un niveau de confiance ; un
élément vérifié conserve sa source, son fournisseur et sa date de récupération.

La cascade Claude → Gemini → OpenRouter reste active pour les tâches sans
outils. L'étendre à la génération suppose d'abord une vraie prise en charge des
outils par chaque fournisseur, à mesurer en F6.

## Architecture cible

L'orchestrateur central conserve le brief, la chronologie, les villes, le
budget, les participants et les décisions. Il pilote :

- des services déterministes : normalisation temporelle, IATA, construction et
  validation d'URL, calculs, conflits, distances et budget ;
- des connecteurs de données : lieux, événements, hébergements, transports et
  météo ;
- le LLM uniquement pour comprendre l'intention, sélectionner parmi des
  résultats réels, adapter le rythme, expliquer et interpréter une modification.

La génération deviendra progressive : plan global, recherches spécialisées,
sélection contrainte, assemblage puis validation finale. Les données porteront
déjà une source et un niveau **Vérifié / Estimé / Suggestion** ; la suite doit
appliquer ce contrat à chaque connecteur spécialisé et aux lots progressifs.

Un sous-agent futur n'est accepté que si une fonction déterministe ne suffit
pas et si son contrat, ses données d'entrée et sa validation sont explicites.
