// The games.fun loot program's Anchor IDL (program FWVap91DnGRU2bid8PZwazZmFfWwJomyeTMKqYsSf53D, Anchor 1.1.2),
// copied from games.fun launchpad/loot/client/idl.json at commit 111d4f926be7ab62dce6e5f7344e23ac6afe2adc with doc
// comments removed. It is games.fun's own program. Both sides encode instructions and decode accounts from it.
export default {
 "address": "FWVap91DnGRU2bid8PZwazZmFfWwJomyeTMKqYsSf53D",
 "metadata": {
  "name": "loot",
  "version": "0.1.0",
  "spec": "0.1.0",
  "description": "Created with Anchor"
 },
 "instructions": [
  {
   "name": "buy_item",
   "discriminator": [80,82,193,201,216,27,70,184],
   "accounts": [
    {
     "name": "player",
     "writable": true,
     "signer": true
    },
    {
     "name": "game",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [103,97,109,101]
       },
       {
        "kind": "account",
        "path": "game.collection",
        "account": "Game"
       }
      ]
     }
    },
    {
     "name": "item",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [105,116,101,109]
       },
       {
        "kind": "account",
        "path": "game"
       },
       {
        "kind": "arg",
        "path": "item_id"
       }
      ]
     }
    },
    {
     "name": "platform",
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [112,108,97,116,102,111,114,109]
       }
      ]
     }
    },
    {
     "name": "order",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [111,114,100,101,114]
       },
       {
        "kind": "account",
        "path": "game"
       },
       {
        "kind": "account",
        "path": "player"
       },
       {
        "kind": "arg",
        "path": "nonce"
       }
      ]
     }
    },
    {
     "name": "escrow",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [101,115,99,114,111,119]
       },
       {
        "kind": "account",
        "path": "order"
       }
      ]
     }
    },
    {
     "name": "mint"
    },
    {
     "name": "player_token",
     "writable": true
    },
    {
     "name": "vault",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "account",
        "path": "game"
       },
       {
        "kind": "const",
        "value": [6,221,246,225,215,101,161,147,217,203,225,70,206,235,121,172,28,180,133,237,95,91,55,145,58,140,245,133,126,255,0,169]
       },
       {
        "kind": "account",
        "path": "mint"
       }
      ],
      "program": {
       "kind": "const",
       "value": [140,151,37,143,78,36,137,241,187,61,16,41,20,142,13,131,11,90,19,153,218,255,16,132,4,142,123,216,219,233,248,89]
      }
     }
    },
    {
     "name": "token_program",
     "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    },
    {
     "name": "associated_token_program",
     "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
    },
    {
     "name": "system_program",
     "address": "11111111111111111111111111111111"
    }
   ],
   "args": [
    {
     "name": "item_id",
     "type": "u32"
    },
    {
     "name": "nonce",
     "type": "u64"
    }
   ]
  },
  {
   "name": "callback_roll",
   "discriminator": [104,43,141,38,167,29,52,209],
   "accounts": [
    {
     "name": "vrf_program_identity",
     "signer": true
    },
    {
     "name": "order",
     "writable": true
    },
    {
     "name": "loot_box"
    }
   ],
   "args": [
    {
     "name": "randomness",
     "type": {
      "array": [
       "u8",
       32
      ]
     }
    }
   ]
  },
  {
   "name": "create_game",
   "discriminator": [124,69,75,66,184,220,72,206],
   "accounts": [
    {
     "name": "authority",
     "writable": true,
     "signer": true
    },
    {
     "name": "game",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [103,97,109,101]
       },
       {
        "kind": "account",
        "path": "collection"
       }
      ]
     }
    },
    {
     "name": "collection"
    },
    {
     "name": "mint"
    },
    {
     "name": "treasury"
    },
    {
     "name": "token_program",
     "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    },
    {
     "name": "system_program",
     "address": "11111111111111111111111111111111"
    }
   ],
   "args": [
    {
     "name": "burn_bps",
     "type": "u16"
    }
   ]
  },
  {
   "name": "init_platform",
   "discriminator": [29,22,210,225,219,114,193,169],
   "accounts": [
    {
     "name": "admin",
     "writable": true,
     "signer": true
    },
    {
     "name": "platform",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [112,108,97,116,102,111,114,109]
       }
      ]
     }
    },
    {
     "name": "program",
     "address": "FWVap91DnGRU2bid8PZwazZmFfWwJomyeTMKqYsSf53D"
    },
    {
     "name": "program_data"
    },
    {
     "name": "system_program",
     "address": "11111111111111111111111111111111"
    }
   ],
   "args": [
    {
     "name": "fee_bps",
     "type": "u16"
    },
    {
     "name": "fee_wallet",
     "type": "pubkey"
    }
   ]
  },
  {
   "name": "open_box",
   "discriminator": [225,220,10,104,173,151,214,199],
   "accounts": [
    {
     "name": "player",
     "writable": true,
     "signer": true
    },
    {
     "name": "game",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [103,97,109,101]
       },
       {
        "kind": "account",
        "path": "game.collection",
        "account": "Game"
       }
      ]
     }
    },
    {
     "name": "loot_box",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [98,111,120]
       },
       {
        "kind": "account",
        "path": "game"
       },
       {
        "kind": "arg",
        "path": "box_id"
       }
      ]
     }
    },
    {
     "name": "platform",
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [112,108,97,116,102,111,114,109]
       }
      ]
     }
    },
    {
     "name": "order",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [111,114,100,101,114]
       },
       {
        "kind": "account",
        "path": "game"
       },
       {
        "kind": "account",
        "path": "player"
       },
       {
        "kind": "arg",
        "path": "nonce"
       }
      ]
     }
    },
    {
     "name": "escrow",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [101,115,99,114,111,119]
       },
       {
        "kind": "account",
        "path": "order"
       }
      ]
     }
    },
    {
     "name": "mint"
    },
    {
     "name": "player_token",
     "writable": true
    },
    {
     "name": "vault",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "account",
        "path": "game"
       },
       {
        "kind": "const",
        "value": [6,221,246,225,215,101,161,147,217,203,225,70,206,235,121,172,28,180,133,237,95,91,55,145,58,140,245,133,126,255,0,169]
       },
       {
        "kind": "account",
        "path": "mint"
       }
      ],
      "program": {
       "kind": "const",
       "value": [140,151,37,143,78,36,137,241,187,61,16,41,20,142,13,131,11,90,19,153,218,255,16,132,4,142,123,216,219,233,248,89]
      }
     }
    },
    {
     "name": "oracle_queue",
     "writable": true
    },
    {
     "name": "token_program",
     "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    },
    {
     "name": "associated_token_program",
     "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
    },
    {
     "name": "system_program",
     "address": "11111111111111111111111111111111"
    },
    {
     "name": "program_identity",
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [105,100,101,110,116,105,116,121]
       }
      ]
     }
    },
    {
     "name": "vrf_program",
     "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
    },
    {
     "name": "slot_hashes",
     "address": "SysvarS1otHashes111111111111111111111111111"
    }
   ],
   "args": [
    {
     "name": "box_id",
     "type": "u32"
    },
    {
     "name": "nonce",
     "type": "u64"
    },
    {
     "name": "client_seed",
     "type": {
      "array": [
       "u8",
       32
      ]
     }
    }
   ]
  },
  {
   "name": "refund",
   "discriminator": [2,96,183,251,63,208,46,46],
   "accounts": [
    {
     "name": "signer",
     "writable": true,
     "signer": true
    },
    {
     "name": "order",
     "writable": true
    },
    {
     "name": "player",
     "writable": true,
     "relations": [
      "order"
     ]
    },
    {
     "name": "game",
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [103,97,109,101]
       },
       {
        "kind": "account",
        "path": "game.collection",
        "account": "Game"
       }
      ]
     },
     "relations": [
      "order"
     ]
    },
    {
     "name": "escrow",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [101,115,99,114,111,119]
       },
       {
        "kind": "account",
        "path": "order"
       }
      ]
     }
    },
    {
     "name": "mint"
    },
    {
     "name": "vault",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "account",
        "path": "game"
       },
       {
        "kind": "const",
        "value": [6,221,246,225,215,101,161,147,217,203,225,70,206,235,121,172,28,180,133,237,95,91,55,145,58,140,245,133,126,255,0,169]
       },
       {
        "kind": "account",
        "path": "mint"
       }
      ],
      "program": {
       "kind": "const",
       "value": [140,151,37,143,78,36,137,241,187,61,16,41,20,142,13,131,11,90,19,153,218,255,16,132,4,142,123,216,219,233,248,89]
      }
     }
    },
    {
     "name": "player_token",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "account",
        "path": "player"
       },
       {
        "kind": "const",
        "value": [6,221,246,225,215,101,161,147,217,203,225,70,206,235,121,172,28,180,133,237,95,91,55,145,58,140,245,133,126,255,0,169]
       },
       {
        "kind": "account",
        "path": "mint"
       }
      ],
      "program": {
       "kind": "const",
       "value": [140,151,37,143,78,36,137,241,187,61,16,41,20,142,13,131,11,90,19,153,218,255,16,132,4,142,123,216,219,233,248,89]
      }
     }
    },
    {
     "name": "token_program",
     "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    },
    {
     "name": "associated_token_program",
     "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
    },
    {
     "name": "system_program",
     "address": "11111111111111111111111111111111"
    }
   ],
   "args": []
  },
  {
   "name": "set_platform",
   "discriminator": [14,33,2,169,153,155,180,248],
   "accounts": [
    {
     "name": "admin",
     "signer": true,
     "relations": [
      "platform"
     ]
    },
    {
     "name": "platform",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [112,108,97,116,102,111,114,109]
       }
      ]
     }
    }
   ],
   "args": [
    {
     "name": "fee_bps",
     "type": "u16"
    },
    {
     "name": "fee_wallet",
     "type": "pubkey"
    },
    {
     "name": "new_admin",
     "type": "pubkey"
    }
   ]
  },
  {
   "name": "settle",
   "discriminator": [175,42,185,87,144,131,102,212],
   "accounts": [
    {
     "name": "signer",
     "writable": true,
     "signer": true
    },
    {
     "name": "order",
     "writable": true
    },
    {
     "name": "player",
     "writable": true,
     "relations": [
      "order"
     ]
    },
    {
     "name": "game",
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [103,97,109,101]
       },
       {
        "kind": "account",
        "path": "game.collection",
        "account": "Game"
       }
      ]
     },
     "relations": [
      "order"
     ]
    },
    {
     "name": "item",
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [105,116,101,109]
       },
       {
        "kind": "account",
        "path": "game"
       },
       {
        "kind": "account",
        "path": "order.item_id",
        "account": "Order"
       }
      ]
     }
    },
    {
     "name": "platform",
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [112,108,97,116,102,111,114,109]
       }
      ]
     }
    },
    {
     "name": "escrow",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [101,115,99,114,111,119]
       },
       {
        "kind": "account",
        "path": "order"
       }
      ]
     }
    },
    {
     "name": "mint",
     "writable": true
    },
    {
     "name": "vault",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "account",
        "path": "game"
       },
       {
        "kind": "const",
        "value": [6,221,246,225,215,101,161,147,217,203,225,70,206,235,121,172,28,180,133,237,95,91,55,145,58,140,245,133,126,255,0,169]
       },
       {
        "kind": "account",
        "path": "mint"
       }
      ],
      "program": {
       "kind": "const",
       "value": [140,151,37,143,78,36,137,241,187,61,16,41,20,142,13,131,11,90,19,153,218,255,16,132,4,142,123,216,219,233,248,89]
      }
     }
    },
    {
     "name": "treasury",
     "writable": true
    },
    {
     "name": "fee_wallet"
    },
    {
     "name": "fee_token",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "account",
        "path": "fee_wallet"
       },
       {
        "kind": "const",
        "value": [6,221,246,225,215,101,161,147,217,203,225,70,206,235,121,172,28,180,133,237,95,91,55,145,58,140,245,133,126,255,0,169]
       },
       {
        "kind": "account",
        "path": "mint"
       }
      ],
      "program": {
       "kind": "const",
       "value": [140,151,37,143,78,36,137,241,187,61,16,41,20,142,13,131,11,90,19,153,218,255,16,132,4,142,123,216,219,233,248,89]
      }
     }
    },
    {
     "name": "collection",
     "writable": true
    },
    {
     "name": "asset",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [97,115,115,101,116]
       },
       {
        "kind": "account",
        "path": "order"
       }
      ]
     }
    },
    {
     "name": "mpl_core_program",
     "address": "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d"
    },
    {
     "name": "token_program",
     "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    },
    {
     "name": "associated_token_program",
     "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
    },
    {
     "name": "system_program",
     "address": "11111111111111111111111111111111"
    }
   ],
   "args": []
  },
  {
   "name": "update_game",
   "discriminator": [159,61,132,131,3,234,209,220],
   "accounts": [
    {
     "name": "authority",
     "signer": true,
     "relations": [
      "game"
     ]
    },
    {
     "name": "game",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [103,97,109,101]
       },
       {
        "kind": "account",
        "path": "game.collection",
        "account": "Game"
       }
      ]
     }
    },
    {
     "name": "treasury"
    }
   ],
   "args": [
    {
     "name": "update",
     "type": {
      "defined": {
       "name": "GameUpdate"
      }
     }
    }
   ]
  },
  {
   "name": "upsert_box",
   "discriminator": [19,118,81,232,2,212,86,66],
   "accounts": [
    {
     "name": "admin",
     "writable": true,
     "signer": true
    },
    {
     "name": "game",
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [103,97,109,101]
       },
       {
        "kind": "account",
        "path": "game.collection",
        "account": "Game"
       }
      ]
     }
    },
    {
     "name": "loot_box",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [98,111,120]
       },
       {
        "kind": "account",
        "path": "game"
       },
       {
        "kind": "arg",
        "path": "box_id"
       }
      ]
     }
    },
    {
     "name": "system_program",
     "address": "11111111111111111111111111111111"
    }
   ],
   "args": [
    {
     "name": "box_id",
     "type": "u32"
    },
    {
     "name": "price",
     "type": "u64"
    },
    {
     "name": "active",
     "type": "bool"
    },
    {
     "name": "entries",
     "type": {
      "vec": {
       "defined": {
        "name": "DropEntry"
       }
      }
     }
    }
   ]
  },
  {
   "name": "upsert_item",
   "discriminator": [162,170,209,51,242,20,147,84],
   "accounts": [
    {
     "name": "admin",
     "writable": true,
     "signer": true
    },
    {
     "name": "game",
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [103,97,109,101]
       },
       {
        "kind": "account",
        "path": "game.collection",
        "account": "Game"
       }
      ]
     }
    },
    {
     "name": "item",
     "writable": true,
     "pda": {
      "seeds": [
       {
        "kind": "const",
        "value": [105,116,101,109]
       },
       {
        "kind": "account",
        "path": "game"
       },
       {
        "kind": "arg",
        "path": "item_id"
       }
      ]
     }
    },
    {
     "name": "system_program",
     "address": "11111111111111111111111111111111"
    }
   ],
   "args": [
    {
     "name": "item_id",
     "type": "u32"
    },
    {
     "name": "args",
     "type": {
      "defined": {
       "name": "ItemArgs"
      }
     }
    }
   ]
  }
 ],
 "accounts": [
  {
   "name": "Game",
   "discriminator": [27,90,166,125,74,100,121,18]
  },
  {
   "name": "ItemDef",
   "discriminator": [226,13,125,160,42,114,138,55]
  },
  {
   "name": "LootBox",
   "discriminator": [128,23,24,158,98,253,135,109]
  },
  {
   "name": "Order",
   "discriminator": [134,173,223,185,77,86,28,51]
  },
  {
   "name": "Platform",
   "discriminator": [77,92,204,58,187,98,91,12]
  }
 ],
 "events": [
  {
   "name": "OrderFailed",
   "discriminator": [60,179,157,0,164,131,38,236]
  },
  {
   "name": "OrderRefunded",
   "discriminator": [120,155,10,169,7,98,202,187]
  },
  {
   "name": "OrderRolled",
   "discriminator": [91,246,84,1,21,64,240,229]
  },
  {
   "name": "OrderSettled",
   "discriminator": [32,21,123,33,68,59,136,131]
  }
 ],
 "errors": [
  {
   "code": 6000,
   "name": "Unauthorized",
   "msg": "Signer is not the game authority or an admin"
  },
  {
   "code": 6001,
   "name": "NotGameAuthority",
   "msg": "Only the game authority can do this"
  },
  {
   "code": 6002,
   "name": "BadCollection",
   "msg": "Collection is not a Core collection owned by this authority"
  },
  {
   "code": 6003,
   "name": "BadBps",
   "msg": "Fee or burn basis points out of range"
  },
  {
   "code": 6004,
   "name": "TooManyAdmins",
   "msg": "Too many admins"
  },
  {
   "code": 6005,
   "name": "StringTooLong",
   "msg": "Name or URI too long"
  },
  {
   "code": 6006,
   "name": "BadEntries",
   "msg": "Box needs 1 to 8 entries with non-zero weights"
  },
  {
   "code": 6007,
   "name": "SupplyBelowIssued",
   "msg": "Max supply is below the number already issued"
  },
  {
   "code": 6008,
   "name": "KindLocked",
   "msg": "Item kind can't change once issued"
  },
  {
   "code": 6009,
   "name": "Paused",
   "msg": "Game is paused"
  },
  {
   "code": 6010,
   "name": "NotForSale",
   "msg": "Box or item is not for sale"
  },
  {
   "code": 6011,
   "name": "SoldOut",
   "msg": "Item is sold out"
  },
  {
   "code": 6012,
   "name": "BadOrderState",
   "msg": "Order is not in the right state"
  },
  {
   "code": 6013,
   "name": "NotStale",
   "msg": "Order is not stale yet"
  },
  {
   "code": 6014,
   "name": "ItemMismatch",
   "msg": "Callback item accounts don't match the box"
  },
  {
   "code": 6015,
   "name": "Overflow",
   "msg": "Arithmetic overflow"
  }
 ],
 "types": [
  {
   "name": "DropEntry",
   "type": {
    "kind": "struct",
    "fields": [
     {
      "name": "item_id",
      "type": "u32"
     },
     {
      "name": "weight",
      "type": "u32"
     }
    ]
   }
  },
  {
   "name": "Game",
   "type": {
    "kind": "struct",
    "fields": [
     {
      "name": "authority",
      "type": "pubkey"
     },
     {
      "name": "admins",
      "type": {
       "vec": "pubkey"
      }
     },
     {
      "name": "collection",
      "type": "pubkey"
     },
     {
      "name": "mint",
      "type": "pubkey"
     },
     {
      "name": "treasury",
      "type": "pubkey"
     },
     {
      "name": "burn_bps",
      "type": "u16"
     },
     {
      "name": "paused",
      "type": "bool"
     },
     {
      "name": "orders",
      "type": "u64"
     },
     {
      "name": "bump",
      "type": "u8"
     }
    ]
   }
  },
  {
   "name": "GameUpdate",
   "type": {
    "kind": "struct",
    "fields": [
     {
      "name": "burn_bps",
      "type": {
       "option": "u16"
      }
     },
     {
      "name": "paused",
      "type": {
       "option": "bool"
      }
     },
     {
      "name": "admins",
      "type": {
       "option": {
        "vec": "pubkey"
       }
      }
     },
     {
      "name": "new_authority",
      "type": {
       "option": "pubkey"
      }
     }
    ]
   }
  },
  {
   "name": "ItemArgs",
   "type": {
    "kind": "struct",
    "fields": [
     {
      "name": "kind",
      "type": {
       "defined": {
        "name": "ItemKind"
       }
      }
     },
     {
      "name": "rarity",
      "type": "u8"
     },
     {
      "name": "soulbound",
      "type": "bool"
     },
     {
      "name": "name",
      "type": "string"
     },
     {
      "name": "uri",
      "type": "string"
     },
     {
      "name": "max_supply",
      "type": "u32"
     },
     {
      "name": "price",
      "type": "u64"
     },
     {
      "name": "active",
      "type": "bool"
     }
    ]
   }
  },
  {
   "name": "ItemDef",
   "type": {
    "kind": "struct",
    "fields": [
     {
      "name": "game",
      "type": "pubkey"
     },
     {
      "name": "item_id",
      "type": "u32"
     },
     {
      "name": "kind",
      "type": {
       "defined": {
        "name": "ItemKind"
       }
      }
     },
     {
      "name": "rarity",
      "type": "u8"
     },
     {
      "name": "soulbound",
      "type": "bool"
     },
     {
      "name": "name",
      "type": "string"
     },
     {
      "name": "uri",
      "type": "string"
     },
     {
      "name": "max_supply",
      "type": "u32"
     },
     {
      "name": "issued",
      "type": "u32"
     },
     {
      "name": "price",
      "type": "u64"
     },
     {
      "name": "active",
      "type": "bool"
     },
     {
      "name": "bump",
      "type": "u8"
     }
    ]
   }
  },
  {
   "name": "ItemKind",
   "type": {
    "kind": "enum",
    "variants": [
     {
      "name": "Normal"
     },
     {
      "name": "Collectible"
     }
    ]
   }
  },
  {
   "name": "LootBox",
   "type": {
    "kind": "struct",
    "fields": [
     {
      "name": "game",
      "type": "pubkey"
     },
     {
      "name": "box_id",
      "type": "u32"
     },
     {
      "name": "price",
      "type": "u64"
     },
     {
      "name": "active",
      "type": "bool"
     },
     {
      "name": "entries",
      "type": {
       "vec": {
        "defined": {
         "name": "DropEntry"
        }
       }
      }
     },
     {
      "name": "opened",
      "type": "u64"
     },
     {
      "name": "bump",
      "type": "u8"
     }
    ]
   }
  },
  {
   "name": "Order",
   "type": {
    "kind": "struct",
    "fields": [
     {
      "name": "game",
      "type": "pubkey"
     },
     {
      "name": "player",
      "type": "pubkey"
     },
     {
      "name": "nonce",
      "type": "u64"
     },
     {
      "name": "loot_box",
      "type": "pubkey"
     },
     {
      "name": "status",
      "type": {
       "defined": {
        "name": "OrderStatus"
       }
      }
     },
     {
      "name": "item_id",
      "type": "u32"
     },
     {
      "name": "serial",
      "type": "u32"
     },
     {
      "name": "paid",
      "type": "u64"
     },
     {
      "name": "fee_bps",
      "type": "u16"
     },
     {
      "name": "burn_bps",
      "type": "u16"
     },
     {
      "name": "randomness",
      "type": {
       "array": [
        "u8",
        32
       ]
      }
     },
     {
      "name": "requested_slot",
      "type": "u64"
     },
     {
      "name": "bump",
      "type": "u8"
     }
    ]
   }
  },
  {
   "name": "OrderFailed",
   "type": {
    "kind": "struct",
    "fields": [
     {
      "name": "order",
      "type": "pubkey"
     },
     {
      "name": "game",
      "type": "pubkey"
     },
     {
      "name": "player",
      "type": "pubkey"
     }
    ]
   }
  },
  {
   "name": "OrderRefunded",
   "type": {
    "kind": "struct",
    "fields": [
     {
      "name": "order",
      "type": "pubkey"
     },
     {
      "name": "game",
      "type": "pubkey"
     },
     {
      "name": "player",
      "type": "pubkey"
     },
     {
      "name": "amount",
      "type": "u64"
     }
    ]
   }
  },
  {
   "name": "OrderRolled",
   "type": {
    "kind": "struct",
    "fields": [
     {
      "name": "order",
      "type": "pubkey"
     },
     {
      "name": "game",
      "type": "pubkey"
     },
     {
      "name": "player",
      "type": "pubkey"
     },
     {
      "name": "loot_box",
      "type": "pubkey"
     },
     {
      "name": "item_id",
      "type": "u32"
     },
     {
      "name": "kind",
      "type": {
       "defined": {
        "name": "ItemKind"
       }
      }
     },
     {
      "name": "serial",
      "type": "u32"
     }
    ]
   }
  },
  {
   "name": "OrderSettled",
   "type": {
    "kind": "struct",
    "fields": [
     {
      "name": "order",
      "type": "pubkey"
     },
     {
      "name": "game",
      "type": "pubkey"
     },
     {
      "name": "player",
      "type": "pubkey"
     },
     {
      "name": "item_id",
      "type": "u32"
     },
     {
      "name": "kind",
      "type": {
       "defined": {
        "name": "ItemKind"
       }
      }
     },
     {
      "name": "serial",
      "type": "u32"
     },
     {
      "name": "asset",
      "type": "pubkey"
     },
     {
      "name": "platform_fee",
      "type": "u64"
     },
     {
      "name": "burned",
      "type": "u64"
     },
     {
      "name": "creator",
      "type": "u64"
     }
    ]
   }
  },
  {
   "name": "OrderStatus",
   "type": {
    "kind": "enum",
    "variants": [
     {
      "name": "Pending"
     },
     {
      "name": "Rolled"
     },
     {
      "name": "Failed"
     }
    ]
   }
  },
  {
   "name": "Platform",
   "type": {
    "kind": "struct",
    "fields": [
     {
      "name": "admin",
      "type": "pubkey"
     },
     {
      "name": "fee_wallet",
      "type": "pubkey"
     },
     {
      "name": "fee_bps",
      "type": "u16"
     },
     {
      "name": "bump",
      "type": "u8"
     }
    ]
   }
  }
 ],
 "constants": [
  {
   "name": "ASSET_SEED",
   "type": "bytes",
   "value": "[97, 115, 115, 101, 116]"
  },
  {
   "name": "BOX_SEED",
   "type": "bytes",
   "value": "[98, 111, 120]"
  },
  {
   "name": "ESCROW_LAMPORTS",
   "type": "u64",
   "value": "6000000"
  },
  {
   "name": "ESCROW_SEED",
   "type": "bytes",
   "value": "[101, 115, 99, 114, 111, 119]"
  },
  {
   "name": "GAME_SEED",
   "type": "bytes",
   "value": "[103, 97, 109, 101]"
  },
  {
   "name": "ITEM_SEED",
   "type": "bytes",
   "value": "[105, 116, 101, 109]"
  },
  {
   "name": "MAX_PLATFORM_FEE_BPS",
   "type": "u16",
   "value": "1000"
  },
  {
   "name": "ORDER_SEED",
   "type": "bytes",
   "value": "[111, 114, 100, 101, 114]"
  },
  {
   "name": "PLATFORM_SEED",
   "type": "bytes",
   "value": "[112, 108, 97, 116, 102, 111, 114, 109]"
  },
  {
   "name": "STALE_SLOTS",
   "type": "u64",
   "value": "1500"
  }
 ]
};
