// Seed script to insert 100 real books into the library database
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Book = require('../models/Book');

const books = [
  // NCERT / School Education
  { title: 'Mathematics Textbook for Class 6', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 3, availableCopies: 3, location: { building: 'Main Wing', floor: '1', shelf: 'A-1' } },
  { title: 'Mathematics Textbook for Class 7', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 3, availableCopies: 3, location: { building: 'Main Wing', floor: '1', shelf: 'A-2' } },
  { title: 'Mathematics Textbook for Class 8', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 3, availableCopies: 3, location: { building: 'Main Wing', floor: '1', shelf: 'A-3' } },
  { title: 'Mathematics Textbook for Class 9', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 3, availableCopies: 3, location: { building: 'Main Wing', floor: '1', shelf: 'A-4' } },
  { title: 'Mathematics Textbook for Class 10', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 4, availableCopies: 4, location: { building: 'Main Wing', floor: '1', shelf: 'B-1' } },
  { title: 'Mathematics Textbook for Class 11 - Part I', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 2, availableCopies: 2, location: { building: 'Main Wing', floor: '1', shelf: 'B-2' } },
  { title: 'Mathematics Textbook for Class 11 - Part II', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 2, availableCopies: 2, location: { building: 'Main Wing', floor: '1', shelf: 'B-3' } },
  { title: 'Mathematics Textbook for Class 12 - Part I', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 2, availableCopies: 2, location: { building: 'Main Wing', floor: '2', shelf: 'C-1' } },
  { title: 'Mathematics Textbook for Class 12 - Part II', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 2, availableCopies: 2, location: { building: 'Main Wing', floor: '2', shelf: 'C-2' } },
  { title: 'NCERT Mathematics Exemplar for Classes 6 to 12', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 2, availableCopies: 2, location: { building: 'Main Wing', floor: '2', shelf: 'C-3' } },
  { title: 'Science - Class 6', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 3, availableCopies: 3, location: { building: 'Main Wing', floor: '1', shelf: 'A-5' } },
  { title: 'Science - Class 10', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 4, availableCopies: 4, location: { building: 'Main Wing', floor: '1', shelf: 'B-4' } },
  { title: 'Physics - Class 12', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 2, availableCopies: 2, location: { building: 'Main Wing', floor: '2', shelf: 'C-4' } },
  { title: 'Chemistry - Class 12', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 2, availableCopies: 2, location: { building: 'Main Wing', floor: '2', shelf: 'C-2' } },
  { title: 'Biology - Class 12', author: 'NCERT', category: 'NCERT', isbn: '', totalCopies: 2, availableCopies: 2, location: { building: 'Main Wing', floor: '2', shelf: 'C-3' } },
  // Competitive Exam
  { title: 'Concepts of Physics', author: 'H.C. Verma', category: 'Competitive Exam', isbn: '9788177090570', totalCopies: 4, availableCopies: 4, location: { building: 'Annex', floor: '1', shelf: 'D-1' } },
  { title: 'Problems in General Physics', author: 'I.E. Irodov', category: 'Competitive Exam', isbn: '9788121910215', totalCopies: 3, availableCopies: 3, location: { building: 'Annex', floor: '1', shelf: 'D-2' } },
  { title: 'Objective General English', author: 'S.P. Bakshi', category: 'Competitive Exam', isbn: '', totalCopies: 3, availableCopies: 3, location: { building: 'Annex', floor: '1', shelf: 'D-3' } },
  { title: 'Indian Polity', author: 'M. Laxmikanth', category: 'Competitive Exam', isbn: '9788196494900', totalCopies: 5, availableCopies: 5, location: { building: 'Annex', floor: '2', shelf: 'E-1' } },
  { title: 'A Modern Approach to Verbal & Non-Verbal Reasoning', author: 'R.S. Aggarwal', category: 'Competitive Exam', isbn: '', totalCopies: 4, availableCopies: 4, location: { building: 'Annex', floor: '2', shelf: 'E-2' } },
  // Programming / CS
  { title: 'Eloquent JavaScript', author: 'Marijn Haverbeke', category: 'Programming', isbn: '9781593279509', totalCopies: 4, availableCopies: 4, location: { building: 'Tech', floor: '1', shelf: 'F-1' } },
  { title: "You Don't Know JS", author: 'Kyle Simpson', category: 'Programming', isbn: '', totalCopies: 3, availableCopies: 3, location: { building: 'Tech', floor: '1', shelf: 'F-2' } },
  { title: 'Clean Code', author: 'Robert C. Martin', category: 'Programming', isbn: '9780132350884', totalCopies: 5, availableCopies: 5, location: { building: 'Tech', floor: '1', shelf: 'F-3' } },
  { title: 'The Pragmatic Programmer', author: 'Andrew Hunt', category: 'Programming', isbn: '9780201616224', totalCopies: 4, availableCopies: 4, location: { building: 'Tech', floor: '2', shelf: 'G-1' } },
  { title: 'Head First Java', author: 'Kathy Sierra', category: 'Programming', isbn: '9780596009205', totalCopies: 3, availableCopies: 3, location: { building: 'Tech', floor: '2', shelf: 'G-2' } },
  { title: 'Introduction to Algorithms', author: 'Cormen, Leiserson, Rivest, Stein', category: 'Programming', isbn: '9780262033848', totalCopies: 5, availableCopies: 5, location: { building: 'Tech', floor: '2', shelf: 'G-3' } },
  // Novels / Fiction
  { title: 'The Alchemist', author: 'Paulo Coelho', category: 'Fiction', isbn: '9780061122415', totalCopies: 4, availableCopies: 4, location: { building: 'Literature', floor: '1', shelf: 'H-1' } },
  { title: 'Harry Potter and the Sorcerer\'s Stone', author: 'J.K. Rowling', category: 'Fiction', isbn: '9780590353427', totalCopies: 5, availableCopies: 5, location: { building: 'Literature', floor: '1', shelf: 'H-2' } },
  { title: 'The Hobbit', author: 'J.R.R. Tolkien', category: 'Fiction', isbn: '9780547928227', totalCopies: 4, availableCopies: 4, location: { building: 'Literature', floor: '1', shelf: 'H-3' } },
  { title: '1984', author: 'George Orwell', category: 'Fiction', isbn: '9780451524935', totalCopies: 4, availableCopies: 4, location: { building: 'Literature', floor: '2', shelf: 'I-1' } },
  { title: 'Pride and Prejudice', author: 'Jane Austen', category: 'Fiction', isbn: '9780141040349', totalCopies: 3, availableCopies: 3, location: { building: 'Literature', floor: '2', shelf: 'I-2' } },
  // Indian Literature
  { title: 'Godan', author: 'Munshi Premchand', category: 'Indian Literature', isbn: '', totalCopies: 3, availableCopies: 3, location: { building: 'Indian', floor: '1', shelf: 'J-1' } },
  { title: 'Malgudi Days', author: 'R.K. Narayan', category: 'Indian Literature', isbn: '', totalCopies: 3, availableCopies: 3, location: { building: 'Indian', floor: '1', shelf: 'J-2' } },
  { title: 'Gitanjali', author: 'Rabindranath Tagore', category: 'Indian Literature', isbn: '', totalCopies: 2, availableCopies: 2, location: { building: 'Indian', floor: '1', shelf: 'J-3' } },
  { title: 'The Girl in the Road', author: 'Romesh Gunesekera', category: 'Indian Literature', isbn: '', totalCopies: 2, availableCopies: 2, location: { building: 'Indian', floor: '2', shelf: 'K-1' } },
  { title: 'Five Point Someone', author: 'Chetan Bhagat', category: 'Indian Literature', isbn: '', totalCopies: 3, availableCopies: 3, location: { building: 'Indian', floor: '2', shelf: 'K-2' } },
  // Children
  { title: 'Diary of a Wimpy Kid: The Short Strips', author: 'Jeff Kinney', category: 'Children', isbn: '9781419737704', totalCopies: 4, availableCopies: 4, location: { building: 'Children', floor: '1', shelf: 'L-1' } },
  { title: 'The Famous Five: Five on a Treasure Island', author: 'Enid Blyton', category: 'Children', isbn: '', totalCopies: 3, availableCopies: 3, location: { building: 'Children', floor: '1', shelf: 'L-2' } },
  { title: 'The Secret Seven', author: 'Enid Blyton', category: 'Children', isbn: '', totalCopies: 3, availableCopies: 3, location: { building: 'Children', floor: '1', shelf: 'L-3' } },
  { title: 'Geronimo Stilton - The Lost Treasure of Olivipe', author: 'Geronimo Stilton', category: 'Children', isbn: '', totalCopies: 2, availableCopies: 2, location: { building: 'Children', floor: '2', shelf: 'M-1' } },
  // Comics
  { title: 'Nagraj: The Complete Saga', author: 'Anupam Sinha', category: 'Comics', isbn: '', totalCopies: 3, availableCopies: 3, location: { building: 'Comics', floor: '1', shelf: 'N-1' } },
  { title: 'Super Commando Dhruva: The Best of Dhruva', author: 'Anupam Sinha', category: 'Comics', isbn: '', totalCopies: 2, availableCopies: 2, location: { building: 'Comics', floor: '1', shelf: 'N-2' } },
  { title: 'Doga: The 50th Issue', author: 'Tarun Kumar Wahi', category: 'Comics', isbn: '', totalCopies: 2, availableCopies: 2, location: { building: 'Comics', floor: '2', shelf: 'O-1' } },
  // Biography / History
  { title: 'The Story of My Experiments with Truth', author: 'Mahatma Gandhi', category: 'Biography', isbn: '', totalCopies: 4, availableCopies: 4, location: { building: 'History', floor: '1', shelf: 'P-1' } },
  { title: 'Wings of Fire', author: 'A.P.J. Abdul Kalam', category: 'Biography', isbn: '9788177468199', totalCopies: 3, availableCopies: 3, location: { building: 'History', floor: '1', shelf: 'P-2' } },
  { title: 'India After Gandhi', author: 'Ramachandra Guha', category: 'History', isbn: '', totalCopies: 3, availableCopies: 3, location: { building: 'History', floor: '2', shelf: 'Q-1' } },
  // Popular Non-Fiction
  { title: 'Sapiens: A Brief History of Humankind', author: 'Yuval Noah Harari', category: 'Non-Fiction', isbn: '9780062316097', totalCopies: 4, availableCopies: 4, location: { building: 'NonFiction', floor: '1', shelf: 'R-1' } },
  { title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', category: 'Non-Fiction', isbn: '9780374533557', totalCopies: 3, availableCopies: 3, location: { building: 'NonFiction', floor: '1', shelf: 'R-2' } },

  // Additional catalogue books
  { title: 'Atomic Habits', author: 'James Clear', category: 'Self Development', isbn: '9780735211292', totalCopies: 4, availableCopies: 4, location: { building: 'NonFiction', floor: '2', shelf: 'R-3' } },
  { title: 'The Psychology of Money', author: 'Morgan Housel', category: 'Finance', isbn: '9780857197689', totalCopies: 3, availableCopies: 3, location: { building: 'Business', floor: '1', shelf: 'S-1' } },
  { title: 'Rich Dad Poor Dad', author: 'Robert T. Kiyosaki', category: 'Finance', isbn: '9781612680194', totalCopies: 3, availableCopies: 3, location: { building: 'Business', floor: '1', shelf: 'S-2' } },
  { title: 'Deep Work', author: 'Cal Newport', category: 'Self Development', isbn: '9781455586691', totalCopies: 3, availableCopies: 3, location: { building: 'NonFiction', floor: '2', shelf: 'R-4' } },
  { title: 'The 7 Habits of Highly Effective People', author: 'Stephen R. Covey', category: 'Self Development', isbn: '9781982137274', totalCopies: 2, availableCopies: 2, location: { building: 'NonFiction', floor: '2', shelf: 'R-5' } },
  { title: 'Zero to One', author: 'Peter Thiel', category: 'Business', isbn: '9780804139298', totalCopies: 2, availableCopies: 2, location: { building: 'Business', floor: '1', shelf: 'S-3' } },
  { title: 'The Lean Startup', author: 'Eric Ries', category: 'Business', isbn: '9780307887894', totalCopies: 2, availableCopies: 2, location: { building: 'Business', floor: '1', shelf: 'S-4' } },
  { title: 'Start with Why', author: 'Simon Sinek', category: 'Business', isbn: '9781591846444', totalCopies: 2, availableCopies: 2, location: { building: 'Business', floor: '2', shelf: 'T-1' } },
  { title: 'Steve Jobs', author: 'Walter Isaacson', category: 'Biography', isbn: '9781451648539', totalCopies: 2, availableCopies: 2, location: { building: 'History', floor: '1', shelf: 'P-3' } },
  { title: 'Becoming', author: 'Michelle Obama', category: 'Biography', isbn: '9781524763138', totalCopies: 2, availableCopies: 2, location: { building: 'History', floor: '1', shelf: 'P-4' } },
  { title: 'Long Walk to Freedom', author: 'Nelson Mandela', category: 'Biography', isbn: '9780316548182', totalCopies: 2, availableCopies: 2, location: { building: 'History', floor: '1', shelf: 'P-5' } },
  { title: 'The Diary of a Young Girl', author: 'Anne Frank', category: 'Biography', isbn: '9780553296983', totalCopies: 3, availableCopies: 3, location: { building: 'History', floor: '2', shelf: 'Q-2' } },
  { title: 'The Book Thief', author: 'Markus Zusak', category: 'Fiction', isbn: '9780375842207', totalCopies: 3, availableCopies: 3, location: { building: 'Literature', floor: '2', shelf: 'I-3' } },
  { title: 'To Kill a Mockingbird', author: 'Harper Lee', category: 'Fiction', isbn: '9780061120084', totalCopies: 3, availableCopies: 3, location: { building: 'Literature', floor: '2', shelf: 'I-4' } },
  { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', category: 'Fiction', isbn: '9780743273565', totalCopies: 3, availableCopies: 3, location: { building: 'Literature', floor: '2', shelf: 'I-5' } },
  { title: 'Animal Farm', author: 'George Orwell', category: 'Fiction', isbn: '9780451526342', totalCopies: 3, availableCopies: 3, location: { building: 'Literature', floor: '2', shelf: 'I-6' } },
  { title: 'The Kite Runner', author: 'Khaled Hosseini', category: 'Fiction', isbn: '9781594631931', totalCopies: 3, availableCopies: 3, location: { building: 'Literature', floor: '2', shelf: 'I-7' } },
  { title: 'A Thousand Splendid Suns', author: 'Khaled Hosseini', category: 'Fiction', isbn: '9781594489501', totalCopies: 2, availableCopies: 2, location: { building: 'Literature', floor: '2', shelf: 'I-8' } },
  { title: 'The Fault in Our Stars', author: 'John Green', category: 'Young Adult', isbn: '9780062208112', totalCopies: 2, availableCopies: 2, location: { building: 'YoungAdult', floor: '1', shelf: 'U-1' } },
  { title: 'The Hunger Games', author: 'Suzanne Collins', category: 'Young Adult', isbn: '9780439023481', totalCopies: 3, availableCopies: 3, location: { building: 'YoungAdult', floor: '1', shelf: 'U-2' } },
  { title: 'Divergent', author: 'Veronica Roth', category: 'Young Adult', isbn: '9780062024039', totalCopies: 2, availableCopies: 2, location: { building: 'YoungAdult', floor: '1', shelf: 'U-3' } },
  { title: 'The Maze Runner', author: 'James Dashner', category: 'Young Adult', isbn: '9780385737944', totalCopies: 2, availableCopies: 2, location: { building: 'YoungAdult', floor: '1', shelf: 'U-4' } },
  { title: 'Percy Jackson and the Olympians: The Lightning Thief', author: 'Rick Riordan', category: 'Young Adult', isbn: '9780786838653', totalCopies: 3, availableCopies: 3, location: { building: 'YoungAdult', floor: '1', shelf: 'U-5' } },
  { title: 'The Chronicles of Narnia', author: 'C.S. Lewis', category: 'Fantasy', isbn: '9780064471190', totalCopies: 3, availableCopies: 3, location: { building: 'Fantasy', floor: '1', shelf: 'V-1' } },
  { title: 'The Lord of the Rings', author: 'J.R.R. Tolkien', category: 'Fantasy', isbn: '9780544003415', totalCopies: 3, availableCopies: 3, location: { building: 'Fantasy', floor: '1', shelf: 'V-2' } },
  { title: 'The Fellowship of the Ring', author: 'J.R.R. Tolkien', category: 'Fantasy', isbn: '9780261103573', totalCopies: 2, availableCopies: 2, location: { building: 'Fantasy', floor: '1', shelf: 'V-3' } },
  { title: 'The Two Towers', author: 'J.R.R. Tolkien', category: 'Fantasy', isbn: '9780261102361', totalCopies: 2, availableCopies: 2, location: { building: 'Fantasy', floor: '1', shelf: 'V-4' } },
  { title: 'The Return of the King', author: 'J.R.R. Tolkien', category: 'Fantasy', isbn: '9780261102378', totalCopies: 2, availableCopies: 2, location: { building: 'Fantasy', floor: '1', shelf: 'V-5' } },
  { title: 'Dune', author: 'Frank Herbert', category: 'Science Fiction', isbn: '9780441172719', totalCopies: 3, availableCopies: 3, location: { building: 'ScienceFiction', floor: '1', shelf: 'W-1' } },
  { title: 'Foundation', author: 'Isaac Asimov', category: 'Science Fiction', isbn: '9780553293357', totalCopies: 2, availableCopies: 2, location: { building: 'ScienceFiction', floor: '1', shelf: 'W-2' } },
  { title: 'Fahrenheit 451', author: 'Ray Bradbury', category: 'Science Fiction', isbn: '9781451678188', totalCopies: 2, availableCopies: 2, location: { building: 'ScienceFiction', floor: '1', shelf: 'W-3' } },
  { title: 'The Martian', author: 'Andy Weir', category: 'Science Fiction', isbn: '9780553418026', totalCopies: 2, availableCopies: 2, location: { building: 'ScienceFiction', floor: '1', shelf: 'W-4' } },
  { title: 'Do Androids Dream of Electric Sheep?', author: 'Philip K. Dick', category: 'Science Fiction', isbn: '9780345404473', totalCopies: 2, availableCopies: 2, location: { building: 'ScienceFiction', floor: '1', shelf: 'W-5' } },
  { title: 'The Silent Patient', author: 'Alex Michaelides', category: 'Mystery', isbn: '9781250301697', totalCopies: 2, availableCopies: 2, location: { building: 'Mystery', floor: '1', shelf: 'X-1' } },
  { title: 'And Then There Were None', author: 'Agatha Christie', category: 'Mystery', isbn: '9780062073488', totalCopies: 3, availableCopies: 3, location: { building: 'Mystery', floor: '1', shelf: 'X-2' } },
  { title: 'The Murder of Roger Ackroyd', author: 'Agatha Christie', category: 'Mystery', isbn: '9780062074001', totalCopies: 2, availableCopies: 2, location: { building: 'Mystery', floor: '1', shelf: 'X-3' } },
  { title: 'The Hound of the Baskervilles', author: 'Arthur Conan Doyle', category: 'Mystery', isbn: '9780140437867', totalCopies: 2, availableCopies: 2, location: { building: 'Mystery', floor: '1', shelf: 'X-4' } },
  { title: 'Sherlock Holmes: The Complete Novels and Stories', author: 'Arthur Conan Doyle', category: 'Mystery', isbn: '9780553328258', totalCopies: 2, availableCopies: 2, location: { building: 'Mystery', floor: '1', shelf: 'X-5' } },
  { title: 'The Power of Habit', author: 'Charles Duhigg', category: 'Self Development', isbn: '9780812981605', totalCopies: 2, availableCopies: 2, location: { building: 'NonFiction', floor: '2', shelf: 'R-6' } },
  { title: 'How to Win Friends and Influence People', author: 'Dale Carnegie', category: 'Self Development', isbn: '9780671027032', totalCopies: 3, availableCopies: 3, location: { building: 'NonFiction', floor: '2', shelf: 'R-7' } },
  { title: 'Ikigai', author: 'Hector Garcia and Francesc Miralles', category: 'Self Development', isbn: '9780143130727', totalCopies: 2, availableCopies: 2, location: { building: 'NonFiction', floor: '2', shelf: 'R-8' } },
  { title: 'The Intelligent Investor', author: 'Benjamin Graham', category: 'Finance', isbn: '9780060555665', totalCopies: 2, availableCopies: 2, location: { building: 'Business', floor: '2', shelf: 'T-2' } },
  { title: 'One Up On Wall Street', author: 'Peter Lynch', category: 'Finance', isbn: '9780743200400', totalCopies: 2, availableCopies: 2, location: { building: 'Business', floor: '2', shelf: 'T-3' } },
  { title: 'The Design of Everyday Things', author: 'Don Norman', category: 'Design', isbn: '9780465050659', totalCopies: 2, availableCopies: 2, location: { building: 'Design', floor: '1', shelf: 'Y-1' } },
  { title: 'Don’t Make Me Think', author: 'Steve Krug', category: 'Design', isbn: '9780321965516', totalCopies: 2, availableCopies: 2, location: { building: 'Design', floor: '1', shelf: 'Y-2' } },
  { title: 'Refactoring UI', author: 'Adam Wathan and Steve Schoger', category: 'Design', isbn: '9780991344658', totalCopies: 2, availableCopies: 2, location: { building: 'Design', floor: '1', shelf: 'Y-3' } },
  { title: 'Computer Networks', author: 'Andrew S. Tanenbaum', category: 'Computer Science', isbn: '9780132126953', totalCopies: 3, availableCopies: 3, location: { building: 'Tech', floor: '3', shelf: 'Z-1' } },
  { title: 'Operating System Concepts', author: 'Abraham Silberschatz', category: 'Computer Science', isbn: '9781119456339', totalCopies: 3, availableCopies: 3, location: { building: 'Tech', floor: '3', shelf: 'Z-2' } },
  { title: 'Computer Organization and Design', author: 'David A. Patterson and John L. Hennessy', category: 'Computer Science', isbn: '9780128201091', totalCopies: 2, availableCopies: 2, location: { building: 'Tech', floor: '3', shelf: 'Z-3' } },
  { title: 'Artificial Intelligence: A Modern Approach', author: 'Stuart Russell and Peter Norvig', category: 'Artificial Intelligence', isbn: '9780134610993', totalCopies: 2, availableCopies: 2, location: { building: 'Tech', floor: '3', shelf: 'Z-4' } },
  { title: 'Hands-On Machine Learning with Scikit-Learn, Keras, and TensorFlow', author: 'Aurélien Géron', category: 'Machine Learning', isbn: '9781098125974', totalCopies: 2, availableCopies: 2, location: { building: 'Tech', floor: '3', shelf: 'Z-5' } }
];

async function seed() {
  try {
    await connectDB();
    // Count existing books with titles from seed to avoid duplicates
    const existingTitles = await Book.find({ title: { $in: books.map(b => b.title) } }).select('title');
    const existingSet = new Set(existingTitles.map(d => d.title));
    const newBooks = books.filter(b => !existingSet.has(b.title));
    if (newBooks.length === 0) {
      console.log('All seed books already exist. No new books inserted.');
      process.exit(0);
    }
    const result = await Book.insertMany(newBooks, { ordered: false });
    console.log(`Inserted ${result.length} new books.`);
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
