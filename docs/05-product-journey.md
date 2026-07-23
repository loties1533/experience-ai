# 05 — Product Journey

> Le parcours **utilisateur** (doc 04) dit ce que la *personne* veut. Le parcours **produit** dit ce que le *produit* fait, en interne. Ce sont deux choses distinctes.

Cycle de vie d'un parcours :

1. **Expression** — l'utilisateur dit son envie en langage naturel.
2. **Compréhension** — le produit extrait l'**intention** et le **contexte**.
3. **Cadrage** — il pose uniquement les questions manquantes → un **brief**.
4. **Validation** — l'utilisateur confirme / corrige le brief avant toute génération.
5. **Génération** — recherche des options + construction de la trame → le **parcours** (état structuré).
6. **Restitution** — l'utilisateur explore, élément par élément.
7. **Modification** — il ajuste ; **seul l'élément visé et ses dépendances** sont recalculés.
8. **Sauvegarde** — l'état persiste ; on peut y revenir.

Les étapes **6 ↔ 7** forment la **boucle** qui fait la valeur.

> Plus tard : *Pendant* (accompagnement sur place), *Après* (feedback), *Mémoire* (apprentissage entre parcours).

---

## Scénario de référence — la première expérience (MVP · EVG · Hugo)
Un **seul** scénario. Toute l'architecture du MVP se construit autour de lui ; les autres histoires servent ensuite à vérifier qu'on n'a rien cassé.
Ce n'est **pas** un happy path : chaque battement nomme **⚠ ce qui peut casser** — c'est ce que le prototype et les interviews iront tester. Chaque ⚠ est une hypothèse falsifiable.

**Qui / quand / quoi.** Hugo, 28 ans, organise l'EVG de son pote Max dans ~6 semaines. Ils seront 8, budget approximatif ~200 €/pers. Il ouvre Experience AI le soir, sur son téléphone, après avoir galéré sur plusieurs onglets. Il **sait** : la date approx., le budget par tête, que Max aime le sport et la fête. Il **ne sait pas** : où, quoi, comment contenter 8 personnes. **Son besoin ce soir** : dégrossir un plan qu'il pourra soumettre au groupe.

| Battement | Le produit répond | ⚠ Ce qui peut casser (à tester) |
|---|---|---|
| Hugo arrive | Une phrase dit ce que fait le produit | ⚠ Comprend-il en 5 s, ou reste-t-il perplexe ? |
| Il raconte librement son besoin | (champ libre, pas de formulaire) | ⚠ Sait-il quoi écrire face à une page blanche, ou veut-il des cases à cocher ? |
| L'IA reformule ce qu'elle a compris | intention + contexte | ⚠ La reformulation sonne-t-elle juste, ou « à côté » (perte de confiance immédiate) ? |
| Elle pose **2 questions** max | seulement l'indispensable | ⚠ Trouve-t-il ça fluide, ou frustrant (« pourquoi elle me demande ça ? ») ? |
| Il valide le brief | — | ⚠ Valide-t-il, ou veut-il déjà tout changer ? |
| Le parcours apparaît | moments + budget ventilé + « pourquoi » par élément | ⚠ Le trouve-t-il crédible et désirable, ou générique/décevant ? |
| « Le paintball, remplace par autre chose » | l'IA change **ce seul** élément, réajuste autour, explique | ⚠ La modif ciblée est-elle magique… ou déroutante (« qu'est-ce qui a bougé ? ») ? |
| Il partage au groupe / sauvegarde | (Max exclu) | ⚠ A-t-il envie de le montrer, ou a-t-il honte du résultat ? |
| Il repart | — | ⚠ **La question qui décide de tout** : reviendrait-il ? recommanderait-il ? aurait-il payé ? |

**Hypothèse centrale de cette expérience :** un organisateur d'EVG *racontera* son besoin en langage libre et *acceptera de dialoguer* avec une IA plutôt que remplir un formulaire.
**Invalidée si :** en interview ou devant le prototype, il bloque sur le champ libre, réclame des filtres, ou dit « bizarre de faire ça avec une IA ». → alors l'entrée du produit est à repenser (nouvel ADR).

> Rôle de ce scénario : devenir **directement un prototype cliquable** à mettre devant un vrai organisateur. Il n'a pas à être beau ni complet — juste assez précis pour être testé, et assez honnête pour pouvoir échouer.
