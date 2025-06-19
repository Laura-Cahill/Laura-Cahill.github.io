/*
File: script.js
GUI Assignment: Using the jQuery Plugin/UI with Your Dynamic Table
Laura Cahill, UMass Lowell Computer Science, laura_cahill@student.uml.edu
Copyright (c) 2025 by Laura. All rights reserved. May be freely copied or
excerpted for educational purposes with credit to the author.
updated by LC on June 19, 2025 at 2:44 PM

Sources used:

HW3:
https://www.w3schools.com/js/js_htmldom_html.asp
https://www.w3schools.com/jsref/met_table_insertrow.asp
https://www.w3schools.com/jsref/jsref_parseint.asp

HW4: 
https://jesseheines.com/~heines/91.461/91.461-2015-16f/461-assn/jQueryUI1.8_Ch06_SliderWidget.pdf
https://api.jqueryui.com/slider/#event-change
https://www.w3schools.com/js/js_htmldom_eventlistener.asp
https://www.w3schools.com/jsref/event_oninput.asp
https://api.jqueryui.com/1.11/tabs/
https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics/Overflow
https://www.w3schools.com/tags/tag_button.asp
https://www.w3schools.com/jsref/met_element_remove.asp
https://stackoverflow.com/questions/18295673/javascript-find-li-index-within-ul
https://www.w3schools.com/jquery/jquery_dom_remove.asp
https://www.w3schools.com/tags/att_input_type_checkbox.asp
https://stackoverflow.com/questions/6049430/how-to-make-a-checkbox-without-a-form
https://www.w3schools.com/jsref/dom_obj_checkbox.asp

*/


//This function takes the inputted 4 values and creates a matching table,
//then stores in in a dynamically created tab. It also creates the buttons
//said tab needs, and the functions those buttons do.


function saveTable() {

  let h1 = document.forms["myForm"]["h1"].value;
  let h2 = document.forms["myForm"]["h2"].value;
  let v1 = document.forms["myForm"]["v1"].value;
  let v2 = document.forms["myForm"]["v2"].value;

  //Apparently my number values weren't clean integers because this code
  //was having trouble with 2 digit numbers until I added these lines
  h1 = parseInt(h1);
  h2 = parseInt(h2); 
  v1 = parseInt(v1);
  v2 = parseInt(v2); 


  var table = document.createElement("table");
  var row;
  var l = 1;
  var row;
  var cell;
  table.innerHTML = "";

  row = table.insertRow(0);
  cell = row.insertCell(0);

  //creates blank upper left cell
  cell.innerHTML = '';
  //creates first row, labeling horizontal axis
  for (i = h1; i <= h2; i++) {
    cell = row.insertCell();
    cell.innerHTML = i;
  }
  //creates rest of table
  for (i = v1; i <= v2; i++) {  
    //vertical axis label
    row = table.insertRow();
    cell = row.insertCell(0);
    cell.innerHTML = i;

    //calculates rest of the row based on row multiplied by column
   for (j = h1; j <= h2; j++) {
      cell = row.insertCell(l);
      cell.innerHTML = i * j;
      l++;
    } 
    l = 1;
  }

    //The table is created and now resides in the table variable


    // This goes on to calculate where the new tab will reside in the list, but also
    // Makes sure to give it a unique id calculated from the id of the latest created 
    //tab. This ensures that if a user deletes a tab in the center, adding more tabs 
    //wont give two tabs the same id
    var numOfTabs = document.getElementById("tabTitles").children.length;
    var newTabNumber = numOfTabs + 1;

    //checks to make sure tags exist before trying to grab the id of the last one.
    //if they dont exist, the new tab gets an id of 1 and the tabs list gets a 
    //delete selected tabs button
    if ( numOfTabs > 0 ){
      let id = document.getElementById("tabTitles").children[numOfTabs - 1].id
      var newTag = parseInt(id) + 1;
    } else {
      var newTag = 1;

      //delete selected tabs button code
      var deleteButton = document.createElement("button");
      deleteButton.setAttribute("type", "button");
      deleteButton.setAttribute(
        "onclick", 
        "deleteSelectedTabs()"
      );
      deleteButton.setAttribute("id", "delete");
      deleteButton.textContent = "delete selected tabs";
      document.getElementById("myTabs").append(deleteButton);
    }

  

    // Creates a new li and a new link with a dynamic id, then puts the link in the li,
    // Then puts li in ul
    var newTabListItem = document.createElement("li");
    var newTabLink = document.createElement("a");

    newTabLink.href = "#tab-" + newTag;
    newTabLink.textContent = "Table";

    document.getElementById("tabTitles").append(newTabListItem);
    
    // Creates the new tab content div, and gives it the id that the link goes to so jquery 
    // knows this is the content of this tab

    var newTab = document.createElement("div");
    newTab.id = "tab-" + newTag;
    newTabListItem.id = newTag;

    // puts the table in the tab
    newTab.appendChild(table);
    
    // Adds the content div to the tabs div
    document.getElementById("myTabs").append(newTab);
    
    //checkbox code, for the user to select, and the deleteSelectedTabs function to check
    var check = document.createElement("INPUT");
    check.setAttribute("type", "checkbox");
    check.setAttribute("id", "check-" + newTag);
    newTabListItem.append(check);


    //x button code, deletes this new tab when clicked
    var xButton = document.createElement("button");
    xButton.setAttribute("type", "button");
    xButton.setAttribute(
      "onclick", 
      "document.getElementById('tab-" + newTag + "').remove();" + 
      "document.getElementById('" + newTag + "').remove();" +
      
      "if (document.getElementById(\"tabTitles\").children.length == 0 )"+ 
      " { document.getElementById('delete').remove(); }"
    );
    xButton.textContent = "X";

    //puts button onto tab
    newTabListItem.append(xButton);

    //puts the list item into the ul of tabs
    newTabListItem.append(newTabLink);

    // Refresh the tabs widget and make the new tab active
    jQuery("#myTabs").tabs("refresh");
    jQuery("#myTabs").tabs("option", "active", numOfTabs);
  

  return 0;
}

//This function does almost the same thing as saveTable(), but without any tab 
//functionality, and displays to a static container
function changeTable() {

  let h1 = document.forms["myForm"]["h1"].value;
  let h2 = document.forms["myForm"]["h2"].value;
  let v1 = document.forms["myForm"]["v1"].value;
  let v2 = document.forms["myForm"]["v2"].value;

  h1 = parseInt(h1);
  h2 = parseInt(h2); 
  v1 = parseInt(v1);
  v2 = parseInt(v2); 


  var table = document.createElement("table");
  var row;
  var l = 1;
  var row;
  var cell;
  table.innerHTML = "";

  row = table.insertRow(0);
  cell = row.insertCell(0);

  //creates blank upper left cell
  cell.innerHTML = '';
  //creates first row, labeling horizontal axis
  for (i = h1; i <= h2; i++) {
    cell = row.insertCell();
    cell.innerHTML = i;
  }
  //creates rest of table
  for (i = v1; i <= v2; i++) {  
    //vertical axis label
    row = table.insertRow();
    cell = row.insertCell(0);
    cell.innerHTML = i;

    //calculates rest of the row based on row multiplied by column
   for (j = h1; j <= h2; j++) {
      cell = row.insertCell(l);
      cell.innerHTML = i * j;
      l++;
    } 
    l = 1;
  }
  //resets div container contents, to get rid of previous table
  document.getElementById("mainTable").innerHTML = "";

  //adds new table to container
  document.getElementById("mainTable").append(table);
  

  return 0;
}


//this function checks through all the tabs, sees if the tab is checked,
//and deletes it if it is.
function deleteSelectedTabs(){
  let deleted = 0;
  totalAtStart = document.getElementById("tabTitles").children.length
  for (let i = totalAtStart - 1; i >= 0; i--) {
    let id = document.getElementById("tabTitles").children[i].id

    if (document.getElementById("check-" + id) != null && document.getElementById("check-" + id).checked) {
      document.getElementById("tab-" + id ).remove();
      document.getElementById(id).remove();
      deleted++
    }
  }
  if ( deleted == totalAtStart) {
    document.getElementById('delete').remove();
  }
}