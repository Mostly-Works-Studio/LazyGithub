const DEFAULT_CONFIG = {
  repoFilter: {
    mode:     'exclude',
    patterns: [],
  },
  tokenPresets: [],
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
