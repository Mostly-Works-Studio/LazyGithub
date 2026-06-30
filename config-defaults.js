const DEFAULT_CONFIG = {
  repoFilter: {
    mode:     'exclude',
    patterns: [],
  },
  tokenPresets: [],
  stacks: [],
  showPrInfoBox:            true,
  prInfoBoxShowRepo:        true,
  prInfoBoxShowAuthor:      true,
  prInfoBoxShowHead:        true,
  prInfoBoxShowBase:        true,
  prDropdownThreshold:      3,
  commentDropdownThreshold: 4,
  actions: [
    {
      trigger:    'prHeader',
      label:      'Set me up!',
      color:      '#c95f0a',
      filter:     { hideOnStates: [], authors: [] },
      tokens:     [],
      onMultiple: 'all',
      action:     { type: 'comment', comment: '' },
    },
  ],
  groups: [],
  repos:  {},
};
