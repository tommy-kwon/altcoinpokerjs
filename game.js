// loaded modules
var utils = require('./utils.js');
var db = require('./models/');
var PokerEvaluator = require('poker-evaluator');

/**
 * Betting Object Type Decleration
 *
 * @typedef {Object} betObj
 * @property {number} amount - number of coins to bet
 * @property {Player} nextPlayer - the player that bet
 */

// events
/**
 * Event for users connecting to the socketio socket
 *
 * @event connection
 */
var connection = 'connection';

/**
 * Event for users joining a room
 *
 * @event join
 * @type {number} -  the room ID to join
 */
var join = 'join';

/**
 * Event for sending hole cards to players
 *
 * @event newPlayerCards
 * @type {object}
 * @property {string} cards - ',' delimited list of cards
 */
var newPlayerCards = 'newPlayerCards';

/**
 * Event to broadcast that the hand has been dealt
 *
 * @event deal
 */
var deal = 'deal';

/**
 * Event to be sent to inform everyone of a bet
 *
 * @event bet
 */
var bet = 'bet';

/**
 * Event to tell the server that a specific user is ready
 *
 * @event ready
 */
var ready = 'ready';

/**
 * Event when a user leaves the game, whether accidentally or purposely
 *
 * @event disconnect
 */
var disconnect = 'disconnect';

/**
 * Max number of players that can sit down at a table.  Others will be watchers
 *
 * @const {number}
 */
var MAX_PLAYERS = 10;

/**
 * The longest time we can possibly wait for a player to reconnect
 *
 * @const {number}
 */
var RECONNET_TIMEOUT_MS = 30 * 1000;

// Globals

/**
 * Hashmap holding all of the rooms currently active
 *
 * @type {Object.<number, Table>}
 */
var rooms = {};

/**
 * Adds a bunch of events to the socketio object
 *
 * @param {SocketIO} socketio
 */
var game = function(socketio) {
    /**
     * Event for users connecting to the socketio socket
     *
     * @listens connection
     */
    socketio.on(
        connection,
        /**
         * Callback for when a user connects
         *
         * @fires newPlayerCards
         * @fires deal
         * @fires bet
         *
         * @param {SocketIO} userSocket -- connected user socket
         */
        function (userSocket) {

            /**
             * The currently connected user as a player
             * @type {Player}
             */
            var player;
            // user-specific handlers

            /**
             * Event for when a user joins a specific room
             *
             * @listens join
             */
            userSocket.on(
                join,

                /**
                 * Callback for a user joining a specific room
                 *
                 * @fires deal
                 * @fires bet
                 * @param {number} roomID the id of the room we are joining
                 */
                function (roomID) {
                    // get the Room object first...
                    db.Room.find(roomID).success(
                        /**
                         * Function to run when we get our room object back
                         * 
                         * @param {db.Room} room - room with roomID
                         */
                        function (room) {
                            /**
                             * The current table
                             *
                             * @type {Table}
                             */
                            var table = null;

                            // instantiate our user now
                            player = new Player(userSocket, room.buyin);
                            console.log(room);
                            userSocket.join(room);

                            // if we haven't instantiated anything yet...
                            if (!(room.id in rooms)) {
                                rooms[room.id] = new Table(room.deck);
                            }
                            table = rooms[room.id];

                            // add our user if we are not full to the table
                            if (table.players.length < MAX_PLAYERS) {
                                table.players.append(player);
                            }

                            // Now that we have the room...

                            /**
                             * Event for when a player readys-up
                             *
                             * @listens ready
                             */
                            userSocket.on(
                                ready,

                                /**
                                 * Function to be run when a player readys up
                                 *
                                 * @fires newPlayerCards
                                 */
                                function () {

                                    // only ready if the game is ready-able
                                    if (!table.isGameBeingPlayed) {
                                        player.isReady = true;
                                    }

                                    if (table.continue()) {
                                        table.players.forEach(

                                            /**
                                             * For every player, let them know their cards
                                             *
                                             * @fires newPlayerCards
                                             */
                                            function (player) {
                                                userSocket.emit(
                                                    newPlayerCards,
                                                    {
                                                        cards: JSON.stringify(player.hand.toJSON())
                                                    }
                                                );
                                            }
                                        );
                                        // tell the entire room cards have been dealt
                                        socketio.in(room.id).emit('deal');
                                    }
                                }
                            );

                            /**
                             * Event listener for players betting
                             * @listens bet
                             */
                            userSocket.on(
                                bet,

                                /**
                                 * Function to run when we get our bet
                                 *
                                 * @param {betObj} data
                                 * @fires bet
                                 */
                                function (data) {
                                    if (table.canBet(player)) {
                                        table.bet(player, data.amount);
                                        data.nextPlayer = table.getNextBetter();
                                        socketio.in(roomID).emit('bet', data);
                                    }
                                    table.continue();
                                }
                            );
                        }
                    );
                }
            );
            /**
             * Handle disconnects
             *
             * @listens disconnect
             */
            userSocket.on(
                disconnect,
                function () {
                    // TODO reconnect stuff here
                }
            );
        }
    );
};


/**
 * Creates a new specific card
 *
 * @constructor
 * @param {(number|char)} rank - the rank, 2-9 or T,J,Q,K,A
 * @param {char} suit - from Card.*
 */
var Card = function(rank, suit) {
    // make sure rank is correct
    if (!((2 <= rank <= 9) || rank === 'T' || rank === 'J' || rank === 'Q' || rank === 'K' || rank === 'A'  )) {
        console.log(rank);
        throw "Incorrect rank";
    }
    // make sure the suit is correct
    switch (suit) {
        case Card.DIAMONDS:
        case Card.CLUBS:
        case Card.SPADES:
        case Card.HEARTS:
            // everything is fine!
            break;
        default:
            console.log(suit);
            throw "Incorrect suit";
    }

    this.rank = rank;
    this.suit = suit;
};

/**
 * The Suit of our card
 *
 * @memberof! Card
 * @instance
 * @type {char}
 */
Card.prototype.suit = Card.DIAMONDS;

/**
 * The Rank of our card
 *
 * @memberof! Card
 * @instance
 * @type {(number|char)}
 */
Card.prototype.rank = 2;

/**
 * Return a string representation of this card
 *
 * @memberof Card
 * @instance
 * @method toString
 * @returns {string} String Representation
 */
Card.prototype.toString = function() {
    return [this.rank, this.suit].join('');
};

/**
 * Return a json representation of this card
 *
 * @method toJSON
 * @instance
 * @memberof Card
 * @returns {string} String Representation
 */
Card.prototype.toJSON = Card.prototype.toString;
/**
 * @memberof! Card
 * @static
 */
Card.DIAMONDS = 'd';
/**
 * @memberof! Card
 * @static
 */
Card.CLUBS = 'c';
/**
 * @memberof! Card
 * @static
 */
Card.SPADES = 's';
/**
 * @memberof! Card
 * @static
 */
Card.HEARTS = 'h';
/**
 * @memberof! Card
 * @static
 */
Card.JACK = 'J';
/**
 * @memberof! Card
 * @static
 */
Card.QUEEN = 'Q';
/**
 * @memberof! Card
 * @static
 */
Card.KING = 'K';
/**
 * @memberof! Card
 * @static
 */
Card.ACE = 'A';
/**
 * @memberof! Card
 * @static
 */
Card.RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 'T', Card.JACK, Card.QUEEN, Card.KING, Card.ACE];
/**
 * @memberof! Card
 * @static
 */
Card.SUITS = [Card.HEARTS, Card.SPADES, Card.CLUBS, Card.DIAMONDS];
/**
 * @memberof! Card
 * @function
 * @static
 * @param {Card} card -- the card to test
 */
Card.isActuallyACard = function (card) {
    return card.hasOwnProperty('rank') && card.hasOwnProperty('suit');
};

/**
 * Hand object
 *
 * @constructor
 * @param {Card[]} cards - list of cards
 */
var Hand = function(cards) {
    // Check that we are in fact, cards
    if (!utils.all(Card.isActuallyACard, cards)) {
        throw "Not all items in hand are cards";
    }
    this.cards = cards;
};

/**
 * List of cards
 *
 * @memberof! Hand
 * @instance
 * @type {Card[]}
 */
Hand.prototype.cards = [];

/**
 * Get the evaluated hand representation
 *
 * @memberof Hand
 * @instance
 * @method
 * @returns {object}
 */
Hand.prototype.getEval = function () {
    // TODO create a better representation
    return PokerEvaluator.evalHand(this.cards);
};

/**
 * Gets a JSONic representation of this hand
 *
 * @memberof Hand
 * @instance
 * @method
 * @returns {object}
 */
Hand.prototype.toJSON = function () {
    return {
        cards: this.cards.map(function (x) { return x.toJSON(); }),
        stats: this.getEval()
    };
};

/**
 * Deck object that holds many cards
 * @constructor
 * @param {Card[]} cards - list of cards in the deck
 */
var Deck = function(cards) {
    // Check that we are in fact, cards
    if (!utils.all(Card.isActuallyACard, cards)) {
        throw "Not all items in hand are cards";
    }
    this.cards = cards;
};

/**
 * @memberof! Deck
 * @instance
 * @type {Card[]}
 */
Deck.prototype.cards = [];

/**
 * Gets a JSONic representation of this deck
 *
 * @memberof Deck
 * @instance
 * @method
 * @returns {object}
 */
Deck.prototype.toJSON = function () {
    return this.cards.map(
        function (card) {
            return card.toJSON();
        }
    );
};

/**
 * Gets a string representation of this deck
 *
 * @memberof Deck
 * @instance
 * @method
 * @returns {string}
 */
Deck.prototype.toString = function () {
    return this.cards.join(',');
};

/**
 * Shuffles the deck of cards
 *
 * @memberof Deck
 * @method
 */
Deck.prototype.shuffle = function () {
    // Fischer-Yates Shuffle
    for (var i = this.cards.length -1; i--; i <= 1) {
        var j = Math.round(Math.random() * i);
        var temp = this.cards[i];
        this.cards[i] = this.cards[j];
        this.cards[j] = temp;
    }
};

/**
 * Gets one card from the top of the deck
 *
 * @memberof Deck
 * @method
 */
Deck.prototype.pop = function () {
    return this.cards.pop();
};

/**
 * Builds a deck suitable for playing poker
 *
 * @returns{Deck} - deck with your ordinary French Deck 52 cards
 */
var PokerDeck = function() {
    // have a place to store all 52 cards
    var cards = [];

    // Create all 52 cards, and fill cards
    Card.SUITS.forEach(
        function (suit) {
            Card.RANKS.forEach(
                function (rank) {
                    cards.push(new Card(rank, suit));
                }
            );
        }
    );

    // build a deck with these cards, and use it as the return value
    return new Deck(cards);
};

/**
 * Player object
 *
 * @constructor
 * @param {SocketIO} socket - socket for the specific user
 * @param {number} coin - how much money they are playing with
 */
var Player = function(socket, coin) {
    this.socket = socket;
    this.coin = coin;
};

/**
 * Handle of the user's socket
 *
 * @memberof! Player
 * @instance
 * @type {SocketIO}
 */
Player.prototype.socket = null;

/**
 * The amount of money the player has to play with
 * 
 * @memberof! Player
 * @instance
 * @type {number}
 */
Player.prototype.coin = 0;

/**
 * The player's current two-card hand
 *
 * @memberof! Hand
 * @instance
 * @type {Hand}
 */
Player.prototype.hand = null;

/**
 * Did this player ready-up?
 *
 * @memberof! Hand
 * @instance
 * @type {bool}
 */
Player.prototype.isReady = false;

/**
 * Table of a poker room
 *
 * @constructor
 * @param {db.Room} room - one specific room that we will update with our info
 */
var Table = function(room) {
    // we need the full DB object
    this.room = room;
};

/**
 * Different stages that we could be in
 *
 * @enum {number}
 * @readonly
 * @memberof! Table
 * @static
 */
Table.stages = {
    STARTED: 0,
    READY: 1,
    DEALT_HOLE_CARDS: 2,
    FLOP: 3,
    TURN: 4,
    RIVER: 5
};

/**
 * Room Object
 * 
 * @memberof! Table
 * @instance
 * @type {Room}
 */
Table.prototype.room = null;

/**
 * The cash money in the pot
 *
 * @memberof! Table
 * @instance
 * @type {number}
 */
Table.prototype.pot = 0;

/**
 * The last stage we completed
 *
 * @memberof! Table
 * @instance
 * @type {number}
 */
Table.prototype.lastStage = Table.stages.STARTED;

/**
 * List of players, in which order stuff should happen
 *
 * @memberof! Table
 * @instance
 * @type {Player[]}
 */
Table.prototype.playingPlayersInOrder = [];

/**
 * Current cards on the table
 * @memberof! Table
 * @instance
 * @type {Card[]}
 */
Table.prototype.cards = [];

/**
 * player bet manager obj
 *
 * @memberof! Table
 * @instance
 * @type {PlayerBetManager}
 */
Table.prototype.playerBetManager = null;

/**
 * Deal hole cards to players
 *
 * @memberof Table
 * @instance
 * @method
 */
Table.prototype.dealToPlayers = function () {
    // We will create players.length piles of two cards, to simulate real dealing
    // Rather than popping two cards off at a time for a player
    var piles = [];
    var deck = this.room.deck;
    var players = this.players;

    // make sure piles is full of arrays
    for (var i = 0; i < players.length; i++) {
        piles[i] = [];
    }

    // do this twice
    for (i = 0; i <= 1; i++) {
        // for as many players as we have
        for (var j = 0; j < players.length; j++) {
            piles[j].push(deck.pop());
        }
    }

    // and... make hands out of'em to the dealer
    for (i = 0; i < players.length; i++) {
        players[i].hand = new Hand(piles[i]);
    }

    // and finally, save the (changed) deck object into the room
    this.room.deck = deck;
    this.room.save();
};

/**
 * Deal the flop to the table
 *
 * @memberof Table
 * @instance
 * @method
 * @todo do it
 */
Table.prototype.dealFlop = function () {
    for (var i = 0; i < 3; i ++) {
        this.cards.push(this.deck.pop());
    }
};

/**
 * Deal the turn to the table
 *
 * @memberof Table
 * @instance
 * @method
 */
Table.prototype.dealTurn = function () {
    this.cards.push(this.deck.pop());
};

/**
 * Deal the river to the table
 *
 * @memberof Table
 * @instance
 * @method
 */
Table.prototype.dealRiver = function () {
    this.cards.push(this.deck.pop());
};

/**
 * Can we start the game?
 *
 * @memberof Table
 * @instance
 * @method
 * @returns {bool}
 */
Table.prototype.isCanWeStart = function () {
    // Conditions:
    // Enough players
    // Everyone is ready
    // Current game not going on
    if (
        this.players.length >= MIN_PLAYERS_TO_START &&
        all(this.players, function (player) { return player.isReady; }) &&
        this.lastStage === Table.stages.STARTED
   ) {
        return true;
   }
    return false;
};

/**
 * Perform a bet for a player
 * @memberof Table
 * @instance
 * @method
 */
Table.prototype.bet = function (player, amount) {
    // TODO
};

/**
 * Can we continue?
 *
 * @memberof Table
 * @instance
 * @method
 * @returns {bool}
 */
Table.prototype.isCanWeContinue = function () {
    // TODO fill out
    switch (this.lastStage) {
        // to continue after having started a game... players must be ready
        case Table.stages.STARTED:
            break;
        // nothing must happen between readying-up and dealing hole cards
        case Table.stages.READY:
            break;
        // to continue after hole cards have been dealt, betting rounds must have occurred
        case Table.stages.DEALT_HOLE_CARDS:
            this.dealToPlayers();
            break;
        // to continue after flop cards have been dealt, betting rounds must have occurred
        case Table.stages.FLOP:
            this.dealFlop();
            break;
        // to continue after turn card has been dealt, betting rounds must have occurred
        case Table.stages.TURN:
            this.dealTurn();
            break;
        // to continue after river card has been dealt, betting rounds must have occurred
        case Table.stages.RIVER:
            this.dealRiver();
            break;
    }
};

/**
 * Move on to the next stage of the game.  Returns success
 *
 * @memberof Table
 * @instance
 * @method
 * @returns {bool}
 */
Table.prototype.continue = function () {
    if (!this.isCanWeContinue()) {
        return false;
    }
    // deal next set of cards, or finish the game

    // go to the next stage
    this.lastStage = (this.lastStage + 1) % Table.stages.RIVER + 1;

    switch (this.lastStage) {
        case Table.stages.STARTED:
            this.reset();
            break;
        case Table.stages.READY:
            break;
        case Table.stages.DEALT_HOLE_CARDS:
            this.dealToPlayers();
            break;
        case Table.stages.FLOP:
            this.dealFlop();
            break;
        case Table.stages.TURN:
            this.dealTurn();
            break;
        case Table.stages.RIVER:
            this.dealRiver();
            break;
    }
};

/**
 * Reset the game to a replayable state
 *
 * @memberof Table
 * @instance
 * @method
 */
Table.prototype.reset = function () {
    // TODO game reset here + winners here
};

/**
 * Object to hold a player's bet for a round
 * 
 * @constructor
 * @param {Player} player - betting player
 * @param {number} [amount=0] - Amount bet.
 */
PlayerBet = function(player, amount) {
    amount = typeof amount !== 'undefined' ? b : 0;
};

/**
 * Player responsible for a bet
 *
 * @memberof! PlayerBet
 * @instance
 * @type {Player}
 */
PlayerBet.prototype.player = null;

/**
 * Amount a player has bet so far this round
 *
 * @memberof! PlayerBet
 * @instance
 * @type {number}
 */
PlayerBet.prototype.amount = 0;

/**
 * Place bet
 *
 * @memberof PlayerBet
 * @instance
 * @param {number} amount to bet
 */
PlayerBet.prototype.bet = function (amount) {
    this.amount += amount;
};

/**
 * Object to manage all of the bets for players
 *
 * @constructor
 * @param {Player[]} players - list of players to manage, in betting order
 */
PlayerBetManager = function (players) {
    var manager = this;

    players.forEach = function (player) {
        manager.playerBets.push(new PlayerBet(player, 0));
    };
};

/**
 * The index of the next person who should bet
 *
 * -1 means we have not had player 0 bet yet
 *  player.length means we've reached the end, and player 0 should bet
 * @memberof! PlayerBetManager
 * @instance
 * @type {number}
 */
PlayerBetManager.prototype.lastBetterIndex = -1;

/**
 * Return the next required PlayerBet that at least must occur
 * e.g. the next player in line MUST bet (at least)10, or MUST bet (at least) 0
 *
 * false if there are no possible bets left
 *
 * @memberof PlayerBetManager
 * @instance
 * @method
 * @returns {(PlayerBet|bool)}
 */
PlayerBetManager.prototype.nextBetter = function () {
    var previousBetter = this.playerBets[this.lastBetterIndex];
    var nextBetter = this.playerBets[this.lastBetterIndex + 1 / this.playerBets.length];
};

/**
 * The players in a bet manager
 *
 * @memberof! PlayerBetManager
 * @instance
 * @type {PlayerBet[]}
 */
PlayerBetManager.prototype.playerBets = [];

/**
 * All players who have raised this round
 *
 * @memberof! PlayerBetManager
 * @instance
 * @type {Player[]}
 */ 
PlayerBetManager.prototype.playersWhoRaised = [];

/**
 * Decides if the player has bet so far
 *
 * @memberof PlayerBetManager
 * @instance
 * @method
 * @param {Player} player - the player who we're questioning about
 * @returns {bool}
 */
PlayerBetManager.prototype.isHasPlayerBet = function (player) {
    // if this is NOT -1, then player has bet
    return this.playersWhoRaised.indexOf(player) != -1
}

/**
 * Bet for a player
 *
 * @memberof PlayerBetManager
 * @instance
 * @method
 * @param {Player} player - better
 * @param {amount} amount - amount bet
 */
PlayerBetManager.prototype.bet = function (player, amount) {
    // can THIS player make that bet?
    if (player.coin < amount) {
        throw "User does not have enough money to play";
    }

    // can all other players HANDLE this bet?
    // TODO handle sidepots
    if (!(all(this.players, function (x) { return x.coin >= amount; }))) {
        throw "Not every player can afford that";
    }

    player.coin -= amount;

    this.playersWhoRaised.push(player);
    this.getPlayerBetByPlayer(player).bet(amount);
};

/**
 * Get the given player's PlayerBet object
 *
 * @memberof PlayerBetmanager
 * @instance
 * @protected
 * @method
 * @param {Player}
 * @returns {PlayerBet}
 */
PlayerBetManager.prototype.getPlayerBetByPlayer = function (player) {
    for (var i = 0; i < this.playerBets.length; i++) {
        var ourPlayerBet = this.playerBets[i];
        if (ourPlayer.player === player ) {
            return ourPlayerBet;
        }
    }
    throw "Can't find him!";
};

// Export everything
module.exports.game = game;
module.exports.Card = Card;
module.exports.Hand = Hand;
module.exports.Deck = Deck;
module.exports.PokerDeck = PokerDeck;
module.exports.Player = Player;
module.exports.Table = Table;
