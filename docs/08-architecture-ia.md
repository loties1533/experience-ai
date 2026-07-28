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

## Limite actuelle

Après l'échec de la boucle d'outils, l'orchestrateur peut appeler le modèle sans
données réelles afin de produire quand même un parcours. Ce comportement est
explicitement **à remplacer en F1** : une suggestion générique peut être
acceptable, une invention présentée comme réelle ne l'est pas.

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
une source et un niveau **Vérifié / Estimé / Suggestion** ; les données
essentielles absentes provoqueront un **Refus**.

Un sous-agent futur n'est accepté que si une fonction déterministe ne suffit
pas et si son contrat, ses données d'entrée et sa validation sont explicites.
